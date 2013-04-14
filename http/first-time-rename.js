scraperwiki.exec('[ -e logs ] || ( echo -n "rename"; mkdir -p logs )', function(text) {
  if (text == "rename") {
    scraperwiki.tool.rename('Untitled dataset');
  }
})

