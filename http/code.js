// Source code repository: https://github.com/frabcus/code-scraper-in-browser-tool/

var settings
var editor
var editorDirty = false
var editorSpinner
var output
var outputSpinner
var status = 'nothing' // currently belief about script execution status: 'running' or 'nothing'
var changing ='' // for starting/stopping states
var saveTimeout // store handle to timeout so can clear it
var online = true // whether browser is online - measured by errors from calling exec endpoint

// Spinner options
var spinnerOptsWhite = {
  lines: 12, // The number of lines to draw
  length: 7, // The length of each line
  width: 4, // The line thickness
  radius: 10, // The radius of the inner circle
  corners: 1, // Corner roundness (0..1)
  rotate: 0, // The rotation offset
  direction: 1, // 1: clockwise, -1: counterclockwise
  color: '#fff', // #rgb or #rrggbb
  speed: 1, // Rounds per second
  trail: 60, // Afterglow percentage
  shadow: false, // Whether to render a shadow
  hwaccel: false, // Whether to use hardware acceleration
  className: 'spinner', // The CSS class to assign to the spinner
  zIndex: 2e9, // The z-index (defaults to 2000000000)
  top: 'auto', // Top position relative to parent in px
  left: 'auto' // Left position relative to parent in px
};
var spinnerOptsBlack = _.clone(spinnerOptsWhite)
spinnerOptsBlack.color = '#000'

// Called when we load from the box filesystem, upon first loading of the page
var done_initial_load = function() {
  // set syntax highlighting a tick later, when we have initial data
  setTimeout(function() {
    set_editor_mode(editor.getValue())
    editor.setReadOnly(false)
    editor.moveCursorTo(0, 0)
    editor.focus()
    editorSpinner.stop()
  }, 1)
}

// Show the language picker
var show_language_picker = function(warning) {
  if (warning)
    $('#languagepicker .languagepicker-warning').show()
  else
    $('#languagepicker .languagepicker-warning').hide()
  $('#languagepicker').show()
}

// When a language is selected
var do_language_picked = function(el) {
  var picked_lang = el.target.href.split("#")[1]
  $.get('examples/' + picked_lang, function(data) {
    set_loaded_data(data)
    update_dirty(true) // force dirty to save the default file
    clear_console()
    $('#languagepicker').hide()
  });
  return false
}
// When cancel is pressed in language picker
var do_language_cancelled = function() {
  $('#languagepicker').hide()
  return false
}


// Called after either loading the code from filesystem, or first time through with new language
var set_loaded_data = function(data) {
  clear_alerts()
  set_editor_mode(data)
  editor.setValue(data)
  update_dirty(false)
  done_initial_load()
}

// Used to initialise editor from the filesystem 
var load_code_from_file = function() {
  console.log("loading...")
  scraperwiki.exec('mkdir -p code && touch code/scraper && cat code/scraper && echo -n swinternalGOTCODEOFSCRAPER', function(data) {
    if (data.indexOf("swinternalGOTCODEOFSCRAPER") == -1) {
      scraperwiki.alert("Trouble loading code!", data, true)
      return
    }
    data = data.replace("swinternalGOTCODEOFSCRAPER", "")
    online = true
    console.log("...loaded")
    set_loaded_data(data)
  }, handle_exec_error)
}

// Handle error
var handle_exec_error = function(jqXHR, textStatus, errorThrown) {
    console.log("got an error:", errorThrown, jqXHR, textStatus)
    // Handle special case of the browser not being connected to the net
    // http://stackoverflow.com/questions/10026204/dialog-box-if-there-is-no-internet-connection-using-jquery-or-ajax
    if (jqXHR.status == 0) { 
      // Wait half a second before error - otherwise they show on page refresh,
      // we only want to show if the browser is disconneted from the network.
      setTimeout(function() {
        clear_alerts()
        online = false
        refresh_saving_message()
      } , 500)
    } else {
      scraperwiki.alert(errorThrown, $(jqXHR.responseText).text(), "error")
    }
}

// Display whether we have unsaved edits,
var update_dirty = function(value) {
  editorDirty = value
  refresh_saving_message()
}

// Refresh the saving and so on text
var refresh_saving_message = function() {
  clearTimeout(saveTimeout)

  if (!online) {
    $("#saved").text("")
    $("#offline").text("Offline, not connected to the Internet")
    return
  }

  $("#offline").text("")
  if (editorDirty) {
    // Wait three seconds and then save. If we get another change
    // in those three seconds, reset that timer to avoid excess saves.
    saveTimeout = setTimeout(save_code, 3000)
    //$("#saved").text("Saving...")
    $("#saved").text("")
  } else {
    $("#saved").text("")
  } 
}


// Prevent navigation away if not saved
// XXX this doesn't seem to work for close events in chrome in the frame
$(window).on('beforeunload', function() {
  if (editorDirty) {
    return "You've made changes that haven't been saved yet."
  }
})

// Work out language we're in from the shebang line
var set_editor_mode = function(code) {
  // for totally blank files, offer language picker
  if (code.match(/^\s*$/)) {
    show_language_picker()
    return false
  }

  var first = code.split("\n")[0]
  if (first.substr(0,2) != "#!") {
    scraperwiki.alert("Specify language in the first line!", "For example, put <code class='inserterHit'>#!/usr/bin/env python</code>, <code class='inserterHit'>#!/usr/bin/env ruby</code> or <a class=\"pointer\" onClick=\"show_language_picker(true);\">choose a language template</a>.", false)
    $('.inserterHit').click(function() {
      var line = $(this).text() + "\n\n"
      editor.moveCursorTo(0,0)
      editor.insert(line)
      editor.focus()
    })
    return false
  }

  // Please add more as you need them and send us a pull request!
  var got_lang
  editor.getSession().setMode("ace/mode/text")
  $.each(languages, function(ix, lang) {
    if (first.indexOf(lang.binary) != -1) {
      got_lang = lang
      editor.getSession().setMode("ace/mode/" + lang.highlight)
      return false
    }
  })

  // Remind them they now need: require 'scraperwiki'
  if (got_lang.binary == 'ruby') {
   if (code.match(/ScraperWiki\./)) {
     if (!code.match(/require\s*\(?\s*['"]scraperwiki['"]/)) {
       scraperwiki.alert("You now need to require the ScraperWiki module!", "Add <code>require 'scraperwiki'</code> to your code. <span class=\"label label-info\">Top tip!</span> You can now install it on any computer with <code>gem install scraperwiki</code>.")
        return false
     }
   }
  }

  return true
}

// Show status in buttons - we have this as we can call it directly
// to make the run button seem more responsive
var update_display_from_status = function(use_status) {
  $("#run").removeClass("btn-primary").removeClass("btn-danger").removeClass("btn-warning").removeClass("btn-success").removeClass('loading')
  if (changing == "starting") {
    $("#run").text("Starting...").addClass("btn-warning").addClass('loading')
  } else if (changing == "stopping") {
    $("#run").text("Stopping...").addClass("btn-warning").addClass('loading')
  } else if (use_status == "running") {
    $("#run").text("Stop!").addClass("btn-danger")
  } else if (use_status == "nothing") {
    $("#run").text("Run!").addClass("btn-primary")
  }
}

// Show/hide things according to current state
var set_status = function(new_status) {
  if (!online) {
    return
  }

  if (new_status != "running" && new_status != "nothing") {
    scraperwiki.alert("Unknown new status!", new_status, true)
    return
  }


  if (new_status != status) {
    console.log("status change", status, "===>", new_status)
    if (new_status == "running") {
      enrunerate_and_poll_output()
    }
    status = new_status
    changing = ""
  }
  update_display_from_status(new_status)
}

// Set schedule menu from status of crontab
var get_schedule_for_display = function() {
  $("#schedule-button").addClass("loading")
  $("#schedule .icon-ok").hide()
  scraperwiki.exec("crontab -l", function(text) {
    $("#schedule-button").removeClass("loading")
    if (text.match(/no crontab/)) {
      $("#schedule-none .icon-ok").show()
      console.log("schedule looks like: none")
    } else if (text.match(/THIS_IS_HOURLY/)) {
      $("#schedule-hourly .icon-ok").show()
      console.log("schedule looks like: hourly")
    } else if (text.match(/@daily/)) {
      $("#schedule-daily .icon-ok").show()
      console.log("schedule looks like: daily")
    } else if (text.match(/THIS_IS_DAILY/)) {
      var matches = text.match(/0 (\d+) \* \* \*/)
      $("#schedule-daily-" + matches[1] + " .icon-ok").show()
      $("#schedule-daily .icon-ok").show()
      console.log("schedule looks like: daily at " + matches[1] + " hour")
    } else if (text.match(/THIS_IS_MONTHLY/)) {
      $("#schedule-monthly .icon-ok").show()
      console.log("schedule looks like: monthly")
    } else {
      console.log("schedule looks like: custom")
    }
  }, handle_exec_error)
}

// When they choose the menu to change schedule
var set_schedule_none = function() {
  $("#schedule-button").addClass("loading")
  scraperwiki.exec("crontab -r", function(text) {
    get_schedule_for_display()
  }, handle_exec_error)
}
var set_schedule_daily = function(hour) {
  $("#schedule-button").addClass("loading")
  scraperwiki.exec("cat tool/crontab-daily | sed s/HOUR/" + hour + "/ | crontab -", function(text) {
    get_schedule_for_display()
  }, handle_exec_error)
}
var set_schedule_hourly = function() {
  $("#schedule-button").addClass("loading")
  var minute = Math.floor(60*Math.random())
  scraperwiki.exec("cat tool/crontab-hourly | sed s/MINUTE/" + minute + "/ | crontab -", function(text) {
    get_schedule_for_display()
  }, handle_exec_error)
}
var set_schedule_monthly = function() {
  $("#schedule-button").addClass("loading")
  scraperwiki.exec("cat tool/crontab-monthly | crontab -", function(text) {
    get_schedule_for_display()
  }, handle_exec_error)
}

// Check status of running script, and get more output as appropriate
var enrunerate_and_poll_output = function(action) {
  action = action || ""
  command = "./tool/enrunerate " + action
  if (action == "run") {
    command = "(git config --global user.email $(whoami); git config --global user.name Anon; cd code; git init; git add scraper; git commit -am 'Ran code in browser') >/dev/null; " + command
  }

  scraperwiki.exec(command, function(text) {
    console.log("enrunerate:", text)
    online = true
    set_status(text)

    // we poll one last time either way to be sure we get end of output...
    var again = false
    if (text == "running") {
      // ... but if script is still "running" we'll trigger the timer to do it again
      again = true
    }
    scraperwiki.exec("tail --lines=10000 logs/out", function(text) {
      // XXX detect no file a better way
      if (text != "cat: logs/out: No such file or directory\n") {
        output.setValue(text)
      }
      outputSpinner.stop()
      output.clearSelection()
      if (again) {
        setTimeout(enrunerate_and_poll_output, 10)
      }
    }, handle_exec_error)
  }, handle_exec_error)
}

// Clear any errors
var clear_alerts = function() {
  $(".alert").remove()
}

// Clear console output
var clear_console = function() {
  // only clear if the thing isn't currently running, or would be misleading
  if (status == "nothing") {
    output.setValue("")
    scraperwiki.exec("rm -f logs/out", function(text) {
    }, handle_exec_error)
  }
}

// Save the code - optionally takes text of extra commands to also 
// in the same "exec" and a callback to run when done
var save_code = function(callback) {
  clearTimeout(saveTimeout) // stop any already scheduled timed saves

  console.log("save_code...")
  var code = editor.getValue()
  var sep = ""
  if (code.length == 0 || code.charAt(code.length - 1) != "\n") {
    sep = "\n" // we need a separator \n at the end of the file for the ENDOFSCRAPER heredoc below
  }
  var cmd = "cat >code/scraper.new.$$ <<\"ENDOFSCRAPER\" &&\n" + code + sep + "ENDOFSCRAPER\n"
  cmd = cmd + "chmod a+x code/scraper.new.$$ && mv code/scraper.new.$$ code/scraper"
  scraperwiki.exec(cmd, function(text) {
    if (text != "") {
        scraperwiki.alert("Trouble saving code!", text, true)
        return
    }
    online = true

    // Check actual content against saved - in case there was a change while we executed
    if (editor.getValue() == code) {
      console.log("Saved fine without interference")
      update_dirty(false)
    } else {
      console.log("Ooops, it got dirty while saving")
      update_dirty(true)
    }

    if (callback) {
      callback(text)
    }
  }, handle_exec_error)
}

// When the "bugs" button is pressed
var do_bugs = function() {
  window.open("https://github.com/frabcus/code-scraper-in-browser-tool/issues", "_blank")
}

// When the "run" button is pressed
var do_run = function() {
  // see https://github.com/frabcus/code-scraper-in-browser-tool/issues/55
  editor.focus()
  // force a check that we have a shebang (#!) line
  clear_alerts()
  var code = editor.getValue()
  if (!set_editor_mode(code)) {
    return
  }

  // if it is already running, stop instead
  if (status == "running") {
    // make button show what we're doing
    changing = "stopping"
    update_display_from_status(status)
    // stop the running code
    enrunerate_and_poll_output("stop")
    return
  }

  // make button show what we're doing
  changing = "starting"
  update_display_from_status(status)
  output.setValue("")
  // save code and run it
  if (editorDirty) {
    save_code(function (text) {
      enrunerate_and_poll_output("run")
    })
  } else {
    enrunerate_and_poll_output("run")
  }
}

// Main entry point
$(document).ready(function() {
  settings = scraperwiki.readSettings()

  // Create editor window, read only until it is ready
  editor = ace.edit("editor")
  editor.setFontSize(16)
  editor.getSession().setUseSoftTabs(true)
  editor.setTheme("ace/theme/monokai")
  editor.renderer.setShowPrintMargin(false)
  editor.on('change', function() {
    update_dirty(true)
  })
  editor.setReadOnly(true)
  editorSpinner = new Spinner(spinnerOptsWhite).spin($('#editor')[0])

  // Load initial code
  load_code_from_file()

  // Create the console output window
  output = ace.edit("output")
  output.setFontSize(16)
  output.setTheme("ace/theme/clouds")
  output.renderer.setShowGutter(false)
  output.renderer.setShowPrintMargin(false)
  output.setHighlightActiveLine(false)
  output.setReadOnly(true)
  // ... we use /bin/sh syntax highlighting, the only other at all
  // credible option for such varied output is plain text, which is dull.
  output.getSession().setMode("ace/mode/sh")
  outputSpinner = new Spinner(spinnerOptsBlack).spin($('#output')[0])
  enrunerate_and_poll_output()

  // Fill in the language picker
  $.each(languages, function(ix, lang) {
    var cls = "secondary collapse out"
    if (lang.primary) {
      cls = ""
    }
    $("#languagepicker ul").append('<li class="' + cls + '"><a href="#' + lang.binary + '">' + lang.human + ' <span style="display: none" class="pull-right muted">#! ' + lang.binary + '</span></a></li>')
  })
  $('#languagepicker a').on('click', do_language_picked)
  $('#languagepicker #cancel').on('click', do_language_cancelled)

  // Bind all the buttons to do something
  $('#bugs').on('click', do_bugs)
  $('#run').on('click', do_run)
  $('[title]').tooltip()

  // Fill in the schedule
  get_schedule_for_display()
  refresh_saving_message()

  $(document).on('keydown', function(e){
    // the keycode for "enter" is 13
    if((e.ctrlKey || e.metaKey) && e.which==13) {
      do_run()
      e.preventDefault()
    }
    // eat ctrl+s for save (see https://github.com/frabcus/code-scraper-in-browser-tool/issues/56)
    if ((e.ctrlKey || e.metaKey) && e.which==83) {
      e.preventDefault()
    }
  })
})

