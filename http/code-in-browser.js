var editor
var editorDirty = false
var output
var state // shared with share.js

// Display whether we have unsaved edits
var update_dirty = function(value) {
  clearTimeout(save_code)
  editorDirty = value
  if (editorDirty) {
    // Wait three seconds and then save. If we get another change
    // in those three seconds, reset that timer to avoid excess saves.
    $("#saved").text("Saving...")
    setTimeout(save_code, 3000)
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
    show_status()
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
  } else if (first.indexOf("R") != -1) {
    editor.getSession().setMode("ace/mode/r")
  } else if (first.indexOf("sh") != -1) {
    editor.getSession().setMode("ace/mode/sh")
  } else {
    editor.getSession().setMode("ace/mode/text")
  }
  return true
}

// Show/hide things according to current state
var show_status = function(status) {
  if (status == "running") {
    $("#run").text("Running...").removeClass("btn-primary").addClass("btn-warning")
  } else {
    $("#run").text("Run!").removeClass("btn-warning").addClass("btn-primary")
  }
}

// Clear any errors
var clear_alerts = function(status) {
  $(".alert").remove()
}

// Save the code - optionally takes text of extra commands to also 
// in the same "exec" and a callback to run when done
var save_code = function(extraCmds, callback) {
  clearTimeout(save_code) // stop any already scheduled timed saves
  var code = editor.getValue()
  var cmd = "cat >scraper.new.$$ <<ENDOFSCRAPER\n" + code + "\nENDOFSCRAPER\n"
  cmd = cmd + "chmod a+x scraper.new.$$; mv scraper.new.$$ scraper; " + extraCmds
  scraperwiki.exec(cmd, function(text) {
    // Check actual content against saved - in case there was a change while we executed
    if (editor.getValue() == code) {
      console.log("Saved fine without intereference")
      update_dirty(false)
    } else {
      console.log("Ooops, it got dirty while saving")
      update_dirty(true)
    }

    if (callback) {
      callback(text)
    }
  }, function(jqXHR, textStatus, errorThrown) {
    scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
  })
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
  show_status("running")
  clear_alerts()

  var code = editor.getValue()
  if (!set_editor_mode(code)) {
    return
  }
  output.setValue("")

  // Save code, run it and start polling for console output
  save_code("./tool/enrunerate run", function (text) {
   console.log("enrunerate run:", text)
   poll_output()
  })
}

// Get more output
var poll_output = function() {
  scraperwiki.exec("./tool/enrunerate", function(text) {
    console.log("enrunerate:", text)

    var again = true
    if (text == "running") {
      show_status("running")
    } else if (text == "nothing") {
      show_status("nothing")
      again = false
    } else {
      scraperwiki.alert("Unknown enrunerate error!", text, true)
      return
    }

    scraperwiki.exec("cat logs/out", function(text) {
      // XXX detect no file a better way
      if (text != "cat: logs/out: No such file or directory\n") {
        output.setValue(text)
      }
      output.clearSelection()
      if (again) {
       setTimeout(poll_output, 1)
      }
    }, function(jqXHR, textStatus, errorThrown) {
        scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
    })
  }, function(jqXHR, textStatus, errorThrown) {
      scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
  })
}

// Main entry point
$(document).ready(function() {
  settings = scraperwiki.readSettings()
  $('#apikey').val(settings.source.apikey)

  async.auto({
    // Load code from file
    load_code: function(callback) {
      console.log("loading...")
      scraperwiki.exec('touch scraper; cat scraper', function(data) {
        // If nothing there, set some default content to get people going
        if (data == "") {
          data = "#!/usr/bin/python\n\nimport scraperwiki\n\n"
        }
        callback(null, data)
      }, function(jqXHR, textStatus, errorThrown) {
         scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
         callback(true, null)
      })
    },
    // Connect to sharejs
    sharejs_connection: function(callback) {
      console.log("connecting...")
      connection = new sharejs.Connection('http://seagrass.goatchurch.org.uk/sharejs/channel')
      callback(null, connection)
    },
    // Wire up shared document on the connection
    share_doc: ['sharejs_connection', function(callback, results) {
      console.log("sharing doc...")
      // XXX need a better token in here. API key?
      var docName = 'scraperwiki-' + scraperwiki.box 
      results.sharejs_connection.open(docName, 'text', function(error, doc) {
        if (error) {
          scraperwiki.alert("Trouble setting up pair editing!", error, true)
          callback(true, null)
        }
        callback(null, doc)
      })
    }],
    share_doc: ['sharejs_connection', function(callback, results) {
      console.log("sharing doc...")
      // XXX need a better token in here. API key?
      var docName = 'scraperwiki-' + scraperwiki.box + '-doc'
      results.sharejs_connection.open(docName, 'text', function(error, doc) {
        if (error) {
          scraperwiki.alert("Trouble setting up pair editing!", error, true)
          callback(true, null)
        }
        callback(null, doc)
      })
    }],
    share_state: ['sharejs_connection', function(callback, results) {
      console.log("sharing state...")
      // XXX need a better token in here. API key?
      var docName = 'scraperwiki-' + scraperwiki.box + '-state'
      results.sharejs_connection.open(docName, 'json', function(error, doc) {
        if (error) {
          scraperwiki.alert("Trouble setting up pair state!", error, true)
          callback(true, null)
        }
        callback(null, doc)
      })
    }]
   }, function(err, results) {
      console.log("all done", err, results)
      if (err) {
        return
      }

      var data = results.load_code
      var doc = results.share_doc
      state = results.share_doc

      // Create editor window
      editor = ace.edit("editor")
      editor.setReadOnly(true)
      editor.getSession().setUseSoftTabs(true)
      editor.setTheme("ace/theme/monokai")
      set_editor_mode(data)
      update_dirty(false) // XXX think this line can go

      doc.attach_ace(editor)
      editor.setValue(data)
      editor.moveCursorTo(0, 0)
      editor.setReadOnly(false)
      editor.focus()
      update_dirty(false)
      editor.on('change', function() {
        update_dirty(true)
      })

      poll_output()
   });

  // Create the console output window
  output = ace.edit("output")
  output.setTheme("ace/theme/monokai")
  // ... we use /bin/sh syntax highlighting, the only other at all
  // credible option for such varied output is plain text, which is dull.
  output.getSession().setMode("ace/mode/sh")

  // Bind all the buttons to do something
  $('#docs').on('click', do_docs)
  $('#bugs').on('click', do_bugs)
  $('#keys').on('click', do_keys)
  $('#run').on('click', do_run)
  $(document).bind('keydown', 'ctrl+r', do_run)
})

