(function () {
  "use strict";

  var BASE = location.origin + "/" + location.pathname.split("/")[1];

  var wid = null;
  try {
    var qp = new URLSearchParams(location.search).get("__wid");
    if (qp) {
      wid = qp;
      try { sessionStorage.setItem("__wid", qp); } catch (e) {}
    } else {
      try { wid = sessionStorage.getItem("__wid") || null; } catch (e) {}
    }
  } catch (e) {}

  function postJson(path, body) {
    return fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body === undefined ? {} : body),
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function makeEvent() {
    var listeners = [];
    return {
      addListener: function (fn) { listeners.push(fn); },
      removeListener: function (fn) {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      hasListener: function (fn) { return listeners.indexOf(fn) >= 0; },
      _fire: function (changes) {
        listeners.slice().forEach(function (fn) {
          try { fn(changes, "local"); } catch (e) { console.error(e); }
        });
      },
    };
  }

  var onChanged = makeEvent();
  var localOnChanged = makeEvent();

  try {
    var es = new EventSource(BASE + "/__events" + (wid ? "?wid=" + encodeURIComponent(wid) : ""));
    es.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && msg.type === "storage" && msg.changes) {
        onChanged._fire(msg.changes);
        localOnChanged._fire(msg.changes);
      }
    };
  } catch (e) {}

  var handles = {};
  var nextId = 1000;

  function liveHandle(id) {
    var h = handles[id];
    return h && !h.closed ? h : null;
  }

  var windows = {
    getCurrent: function () {
      return Promise.resolve({ id: wid ? Number(wid) : -1 });
    },
    create: function (opts) {
      opts = opts || {};
      var features;
      if (opts.type === "popup") {
        features = "popup,width=" + opts.width + ",height=" + opts.height;
      }
      var handle = window.open(opts.url, "_blank", features);
      if (!handle) return Promise.reject(new Error("popup blocked"));
      var id = nextId++;
      handles[id] = handle;
      return Promise.resolve({ id: id, tabs: [{ id: id }] });
    },
    update: function (id, props) {
      var h = handles[id];
      if (h && props && props.focused) {
        try { h.focus(); } catch (e) {}
      }
      return Promise.resolve({ id: id });
    },
    remove: function (id) {
      var isCurrent = id === -1 || (wid && Number(id) === Number(wid));
      if (isCurrent) {
        if (wid) {
          try {
            fetch(BASE + "/__api/close?wid=" + encodeURIComponent(wid), {
              method: "POST",
              keepalive: true,
            });
          } catch (e) {}
        }
        try { window.close(); } catch (e) {}
        setTimeout(function () {
          if (!window.closed) {
            var div = document.createElement("div");
            div.style.cssText =
              "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
              "font:16px system-ui,sans-serif;";
            div.textContent = "Done. You can close this tab.";
            document.body.textContent = "";
            document.body.appendChild(div);
          }
        }, 150);
      } else {
        var h = handles[id];
        if (h) {
          try { h.close(); } catch (e) {}
          delete handles[id];
        }
      }
      return Promise.resolve();
    },
  };

  var tabs = {
    create: function (opts) {
      window.open(new URL(opts.url, BASE + "/").href, "_blank");
      return Promise.resolve({ id: nextId++ });
    },
    query: function (q) {
      var id = q && q.windowId;
      if (liveHandle(id)) return Promise.resolve([{ id: id }]);
      return Promise.reject(new Error("No window"));
    },
    update: function (tabId, props) {
      var h = liveHandle(tabId);
      if (!h) return Promise.reject(new Error("No window"));
      h.location.href = props.url;
      return Promise.resolve({ id: tabId });
    },
  };

  window.chrome = {
    runtime: {
      id: "standup-break-vscode",
      getURL: function (p) { return BASE + "/" + p; },
      sendMessage: function (msg) {
        return postJson("/__api/message", msg).then(function (r) { return r.response; });
      },
      openOptionsPage: function () {
        window.open(BASE + "/options.html", "_blank");
      },
    },
    storage: {
      local: {
        get: function (keys) { return postJson("/__api/storage/get", { keys: keys }); },
        set: function (items) { return postJson("/__api/storage/set", { items: items }).then(function () {}); },
        remove: function (keys) { return postJson("/__api/storage/remove", { keys: keys }).then(function () {}); },
        onChanged: localOnChanged,
      },
      onChanged: onChanged,
    },
    windows: windows,
    tabs: tabs,
  };
})();
