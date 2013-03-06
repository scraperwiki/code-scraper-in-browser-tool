// Source code repository: https://github.com/frabcus/code-scraper-in-browser-tool/

var connection
var editor
var editorDirty = false
var editorShare
var output
var status = 'nothing' // reflects what status the buttons show: 'running' or 'nothing'
var changing ='' // for starting/stopping states
var stateShare // various things shared with share.js, including group consideration of the running status
var saveTimeout

// Set up editor whenever we have a good share.js connection
var load_and_wire_up_editor = function() {
  async.parallel( [
    // Wire up shared document on the connection
    function(callback) {
      console.log("sharing doc...")
      // XXX need a better token in here. API key?
      var docName = 'scraperwiki-' + scraperwiki.box + '-doc011'
      connection.open(docName, 'text', function(error, doc) {
        if (error) {
          console.log("sharing doc error", error)
          scraperwiki.alert("Trouble setting up pair editing!", error, true)
          callback(true, null)
        }
        console.log("...shared doc")
        editorShare = doc
        editorShare.attach_ace(editor)

        if (editorShare.created) {
          load_code_from_file()
        } else {
          // get syntax highlighting right
          set_editor_mode(editor.getValue())
        }
        editor.moveCursorTo(0, 0)
        editor.focus()
      })
    },
    // Wire up shared state on the connection
    function(callback) {
      console.log("sharing state...")
      // XXX need a better token in here. API key?
      var docName = 'scraperwiki-' + scraperwiki.box + '-state011'
      connection.open(docName, 'json', function(error, doc) {
        if (error) {
          console.log("sharing state error", error)
          scraperwiki.alert("Trouble setting up pair state!", error, true)
          callback(true, null)
        }
        stateShare = doc
        if (stateShare.created) {
          console.log("first time this state connection has been used, initialising")
          stateShare.submitOp([{p:[],od:null,oi:{status:'nothing'}}])
        }
        stateShare.on('change', function (op) {
          shared_state_update(op)
        })
        console.log("...shared state")
      })
    }
  ]);
}

// Used to initialise what is in the ShareJS server from the filesystem the
// first time run for the instantiation of the ShareJS server.
var load_code_from_file = function() {
  console.log("loading...")
  scraperwiki.exec('mkdir -p code && touch code/scraper && cat code/scraper && echo -n swinternalGOTCODEOFSCRAPER', function(data) {
    if (data.indexOf("swinternalGOTCODEOFSCRAPER") == -1) {
      scraperwiki.alert("Trouble loading code!", data, true)
      return
    }
    data = data.replace("swinternalGOTCODEOFSCRAPER", "")

    // If nothing there, set some default content to get people going
    if (data.match(/^\s*$/)) {
      data = "#!/usr/bin/python\n\nimport scraperwiki\n\n"
    }
    console.log("...loaded")

    set_editor_mode(data)
    editor.setValue(data) // XXX this overrides what is in filesystem on top of what is in sharejs
    editor.moveCursorTo(0, 0)
    editor.focus()
    update_dirty(false)
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
        scraperwiki.alert("No connection to Internet!", "", false)
      } , 500)
    } else {
      scraperwiki.alert(errorThrown, $(jqXHR.responseText).text(), "error")
    }
}

// Display whether we have unsaved edits,
var update_dirty = function(value) {
  clearTimeout(saveTimeout)
  editorDirty = value
  if (editorDirty) {
    // Wait three seconds and then save. If we get another change
    // in those three seconds, reset that timer to avoid excess saves.
    $("#saved").text("Saving...")
    saveTimeout = setTimeout(save_code, 3000)
  } else {
    $("#saved").text("All changes saved")
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
  var first = code.split("\n")[0]
  if (first.substr(0,2) != "#!") {
    scraperwiki.alert("Specify language in the first line!", "For example, put <code>#!/usr/bin/ruby</code>, <code>#!/usr/bin/R</code> or <code>#!/usr/bin/python</code>.", false)
    return false
  }
  // Please add more as you need them and send us a pull request!
  if (first.indexOf("python") != -1) {
    editor.getSession().setMode("ace/mode/python")
  } else if (first.indexOf("ruby") != -1) {
    editor.getSession().setMode("ace/mode/ruby")
  } else if (first.indexOf("perl") != -1) {
    editor.getSession().setMode("ace/mode/perl")
  } else if (first.indexOf("node") != -1) {
    editor.getSession().setMode("ace/mode/javascript")
  } else if (first.indexOf("coffee") != -1) {
    editor.getSession().setMode("ace/mode/coffee")
  } else if (first.indexOf("clojure") != -1) {
    editor.getSession().setMode("ace/mode/clojure")
  } else if (first.indexOf("tcc") != -1) {
    editor.getSession().setMode("ace/mode/c_cpp")
  } else if (first.indexOf("R") != -1) {
    editor.getSession().setMode("ace/mode/r")
  } else if (first.indexOf("sh") != -1) {
    editor.getSession().setMode("ace/mode/sh")
  } else {
    editor.getSession().setMode("ace/mode/text")
  }
  return true
}

// Got a new state over ShareJS (from ourselves or remote clients)
var shared_state_update = function(op) {
  console.log("shared_state_update", stateShare.snapshot)

  // Respond to the status change
  var new_status = stateShare.snapshot.status
  if (new_status != status) {
    console.log("status change", status, "===>", new_status)
    if (new_status == "running") {
      poll_output()
    }
    status = new_status
    changing = ""
  }
  update_display_from_status(new_status)
}

// Show status in buttons - we have this as we can call it directly
// to make the run button seem more responsive
var update_display_from_status = function(use_status) {
  $("#run").removeClass("btn-primary").removeClass("btn-danger").removeClass("btn-warning").removeClass("btn-success")
  if (changing == "starting") {
    $("#run").text("Starting...").addClass("btn-warning")
  } else if (changing == "stopping") {
    $("#run").text("Stopping...").addClass("btn-danger")
  } else if (use_status == "running") {
    $("#run").text("Running...").addClass("btn-success")
  } else if (use_status == "nothing") {
    $("#run").text("Run!").addClass("btn-primary")
  }
}

// Show/hide things according to current state
var set_status = function(new_status) {
  if (new_status != "running" && new_status != "nothing") {
    scraperwiki.alert("Unknown new status!", new_status, true)
    return
  }

  // Tell other ShareJS clients the status has changed
  try {
    stateShare.submitOp( {p:['status'],od:status,oi:new_status})
  } catch (e) {
    scraperwiki.alert("Error saving to ShareJS!", e, true)
  }
}

// Console get more output
var poll_output = function() {
  scraperwiki.exec("./tool/enrunerate", function(text) {
    console.log("enrunerate:", text, "len:", text.length)
    set_status(text)

    // we poll one last time either way to be sure we get end of output...
    var again = false
    if (text == "running") {
      // ... but if script is still "running" we'll trigger the timer to do it again
      again = true
    }
    scraperwiki.exec("cat logs/out", function(text) {
      // XXX detect no file a better way
      if (text != "cat: logs/out: No such file or directory\n") {
        output.setValue(text)
      }
      output.clearSelection()
      if (again) {
        setTimeout(poll_output, 10)
      }
    }, handle_exec_error)
  }, handle_exec_error)
}

// Clear any errors
var clear_alerts = function() {
  $(".alert").remove()
}

// Save the code - optionally takes text of extra commands to also 
// in the same "exec" and a callback to run when done
var save_code = function(callback) {
  clearTimeout(saveTimeout) // stop any already scheduled timed saves

  if (!editorShare) {
    console.log("not saving, no share connection")
    return
  }

  console.log("save_code... version", editorShare.version)
  var code = editor.getValue()
  if (code.length == 0 || code.charAt(code.length - 1) != "\n") {
    code += "\n" // we need a separator \n at the end of the file for the ENDOFSCRAPER heredoc below
  }
  var cmd = "cat >code/scraper.new.$$ <<ENDOFSCRAPER &&\n" + code + "ENDOFSCRAPER\n"
  cmd = cmd + "chmod a+x code/scraper.new.$$ && mv code/scraper.new.$$ code/scraper"
  scraperwiki.exec(cmd, function(text) {
    if (text != "") {
        scraperwiki.alert("Trouble saving code!", text, true)
        return
    }

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

// When the "documentation" button is pressed
var do_docs = function() {
  window.open("https://scraperwiki.com/docs/", "_blank")
}

// When the "bugs" button is pressed
var do_bugs = function() {
  window.open("https://github.com/frabcus/code-scraper-in-browser-tool/issues", "_blank")
}

// When the "keys" button is pressed
var do_keys = function() {
  window.open("https://github.com/ajaxorg/ace/wiki/Default-Keyboard-Shortcuts", "_blank")
}

// When the "run" button is pressed
var do_run = function() {
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

    scraperwiki.exec("./tool/enrunerate stop", function(text) {
      console.log("enrunerate stop:", text)
      // And tell all clients that we're now not running code (if we're not!)
      set_status(text)
    }, handle_exec_error)
    return
  }

  // to make button feel responsibe, temporarily show the wrong status
  // (until next operation makes it right)
  changing = "starting"
  update_display_from_status(status)
  output.setValue("")

  // Save code
  save_code(function (text) {
    // Then run it
    scraperwiki.exec("./tool/enrunerate run", function(text) {
      console.log("enrunerate run:", text)
      // And tell all clients that we're now running code (if we are!)
      set_status(text)
    }, handle_exec_error)
  })
}

// Main entry point
$(document).ready(function() {
  settings = scraperwiki.readSettings()
  $('#apikey').val(settings.source.apikey)

  // Create editor window, read only until it is ready
  editor = ace.edit("editor")
  editor.getSession().setUseSoftTabs(true)
  editor.setTheme("ace/theme/monokai")
  editor.on('change', function() {
    update_dirty(true)
  })

  // Connect to sharejs server
  console.log("connecting...")
  connection = new sharejs.Connection('http://seagrass.goatchurch.org.uk/sharejs/channel')
  connection.on("error", function(e) {
      console.log("sharejs connection: error")
      clear_alerts()
      scraperwiki.alert("Editor is offline!", e, false)
  })
  connection.on("ok", function(e) {
      console.log("sharejs connection: ok")
      clear_alerts()
  })
  console.log("...connected")
  load_and_wire_up_editor()

  // Create the console output window
  output = ace.edit("output")
  output.setTheme("ace/theme/monokai")
  // ... we use /bin/sh syntax highlighting, the only other at all
  // credible option for such varied output is plain text, which is dull.
  output.getSession().setMode("ace/mode/sh")
  poll_output()

  // Bind all the buttons to do something
  $('#docs').on('click', do_docs)
  $('#bugs').on('click', do_bugs)
  $('#keys').on('click', do_keys)
  $('#run').on('click', do_run)
  $(document).bind('keydown', 'ctrl+r', do_run)
})

