/* Frontend API.
   USE_MOCK stays true until the backend is attached.
   Then set USE_MOCK to false and BASE to the API origin.

   POST /api/auth/login     { email, password } -> { token, user: { email, name } }
   POST /api/auth/logout
   GET  /api/projects       -> ProjectSummary[]
   POST /api/projects       { name, place } -> Project
   GET  /api/projects/:id   -> Project
   POST /api/projects/:id/discover
   POST /api/projects/:id/foundations
   POST /api/projects/:id/structure

   Project.sheets[].shapes[] is { id, kind, label, points: [[x, y], ...], dashed? }
   Project.comparison[] is { id, section, label, unit, digits, bill, ours, note }
   Capability status is "ready", "partial", or "blocked".
*/
(function () {
  const USE_MOCK = false;
  const BASE = "";
  const SESSION = "constech.takeoff.session";
  const PATCHES = "constech.takeoff.patches";

  let cache = [];

  function session() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION) || "null");
    } catch (err) {
      return null;
    }
  }

  function patches() {
    try {
      return JSON.parse(sessionStorage.getItem(PATCHES) || "null") || { created: [], runs: {} };
    } catch (err) {
      return { created: [], runs: {} };
    }
  }

  function savePatches(value) {
    sessionStorage.setItem(PATCHES, JSON.stringify(value));
  }

  function headers() {
    const user = session();
    const result = { "Content-Type": "application/json" };
    if (user && user.token) result.Authorization = "Bearer " + user.token;
    return result;
  }

  async function request(path, options) {
    const response = await fetch(BASE + path, Object.assign({ headers: headers() }, options || {}));
    if (!response.ok) {
      let message = "The server could not complete that request.";
      try {
        const body = await response.json();
        if (body && body.message) message = body.message;
      } catch (err) {
        /* keep the fallback message */
      }
      throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function nameFrom(email) {
    const raw = String(email).split("@")[0].replace(/[._-]+/g, " ");
    return raw.replace(/\b\w/g, function (ch) {
      return ch.toUpperCase();
    });
  }

  function applyMock() {
    cache = structuredClone(window.BOQ_DATA.projects);
    const patch = patches();
    cache.forEach(function (project) {
      const runs = patch.runs[project.id];
      if (runs) project.runs = Object.assign({}, project.runs, runs);
    });
    patch.created.forEach(function (project) {
      cache.push(project);
    });
  }

  async function load() {
    if (USE_MOCK) {
      applyMock();
      return cache;
    }
    cache = await request("/api/projects?detail=full");
    return cache;
  }

  function get(id) {
    return cache.find(function (project) {
      return project.id === id;
    }) || null;
  }

  function summarize(project) {
    const rows = project.comparison || [];
    const bands = { close: 0, near: 0, far: 0 };
    rows.forEach(function (row) {
      if (row.bill == null || row.ours == null || !row.bill) return;
      const pct = Math.abs((row.ours - row.bill) / row.bill * 100);
      if (pct <= 5) bands.close += 1;
      else if (pct <= 15) bands.near += 1;
      else bands.far += 1;
    });
    const measured = project.sheets.filter(function (sheet) {
      return sheet.shapes && sheet.shapes.length;
    }).length;
    return {
      id: project.id,
      name: project.name,
      place: project.place,
      bill: project.bill,
      updated: project.updated,
      drawings: project.sheets.length,
      measuredSheets: measured,
      runs: project.runs,
      capabilities: project.capabilities,
      close: bands.close,
      near: bands.near,
      far: bands.far,
      compared: rows.length,
    };
  }

  const messages = {
    discover: "Drawing register updated.",
    foundations: "Foundation measure finished. Review the outlines on the foundation sheet.",
    structure: "Structure measure finished. Columns, slabs, beams, and walls are ready to review.",
  };

  window.BOQ_API = {
    useMock: USE_MOCK,
    session: session,
    load: load,
    get: get,
    list: function () {
      return cache.map(summarize);
    },
    login: async function (email, password) {
      if (USE_MOCK) {
        await wait(350);
        const user = { email: email, name: nameFrom(email), token: "preview-token" };
        sessionStorage.setItem(SESSION, JSON.stringify(user));
        await load();
        return user;
      }
      const user = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email, password: password }),
      });
      sessionStorage.setItem(SESSION, JSON.stringify(user));
      await load();
      return user;
    },
    logout: async function () {
      sessionStorage.removeItem(SESSION);
      if (!USE_MOCK) {
        try {
          await request("/api/auth/logout", { method: "POST" });
        } catch (err) {
          /* the local session is already cleared */
        }
      }
      cache = [];
    },
    createProject: async function (name, place) {
      if (USE_MOCK) {
        await wait(300);
        const project = {
          id: "p" + Date.now().toString(36),
          name: name,
          place: place || "Dubai",
          bill: "",
          updated: "Just added",
          sample: false,
          runs: { discover: false, foundations: false, structure: false },
          capabilities: [],
          sheets: [],
          comparison: [],
        };
        cache.push(project);
        const patch = patches();
        patch.created.push(project);
        savePatches(patch);
        return project;
      }
      const project = await request("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: name, place: place }),
      });
      cache.push(project);
      return project;
    },
    run: async function (id, kind) {
      if (USE_MOCK) {
        await wait(700);
        const project = get(id);
        if (!project) throw new Error("That project is not on this account.");
        project.runs = project.runs || {};
        project.runs[kind] = true;
        const patch = patches();
        patch.runs[id] = Object.assign({}, patch.runs[id], project.runs);
        savePatches(patch);
        return { message: messages[kind] || "Finished." };
      }
      const result = await request("/api/projects/" + encodeURIComponent(id) + "/" + kind, { method: "POST" });
      await load();
      return result;
    },
  };
})();
