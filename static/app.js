const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");

const LOOKING_LABEL = { male: "Male", female: "Female", lgbtq: "LGBTQ", any: "Any" };
const EDU_LABEL = {
  high_school: "High school",
  associate: "Associate",
  bachelor: "Bachelor",
  master: "Master",
  doctorate: "Doctorate",
  other: "Other",
  any: "Any",
};

const state = {
  token: localStorage.getItem("meet50_token") || "",
  user: null,
  nearby: null,
  inbox: null,
  meetup: null,
  chat: null,
  cameraStream: null,
  photoId: null,
  map: null,
  poll: null,
};

function route() {
  const hash = (location.hash || "#/").replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  return { path: "/" + parts.join("/"), parts };
}

async function api(method, path, body) {
  const headers = { Accept: "application/json" };
  if (state.token) headers.Authorization = "Bearer " + state.token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch("/api" + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
}

function go(path) {
  stopCamera();
  if (state.poll) {
    clearInterval(state.poll);
    state.poll = null;
  }
  if (state.map) {
    try {
      state.map.remove();
    } catch (_) {}
    state.map = null;
  }
  location.hash = path;
}

function fmtMiles(n) {
  if (n == null) return "—";
  return n < 10 ? n.toFixed(1) + " mi" : Math.round(n) + " mi";
}

function fmtLeft(ts) {
  if (!ts) return "no expiry";
  const m = Math.max(0, Math.ceil((ts - Date.now()) / 60000));
  if (m <= 0) return "expired";
  return m + " min";
}

function avatar(url, name) {
  if (url) return `<img class="avatar" src="${url}" alt="${esc(name || "")}" />`;
  return `<div class="avatar"></div>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function lookingOptions(selected, includeAny) {
  const vals = includeAny ? ["any", "male", "female", "lgbtq"] : ["male", "female", "lgbtq"];
  return vals
    .map((v) => `<option value="${v}" ${selected === v ? "selected" : ""}>${LOOKING_LABEL[v]}</option>`)
    .join("");
}

function eduOptions(selected, includeAny) {
  const vals = includeAny
    ? ["any", "high_school", "associate", "bachelor", "master", "doctorate", "other"]
    : ["high_school", "associate", "bachelor", "master", "doctorate", "other"];
  return vals
    .map((v) => `<option value="${v}" ${selected === v ? "selected" : ""}>${EDU_LABEL[v]}</option>`)
    .join("");
}

function nav(active) {
  const paid = state.user?.plan === "paid";
  return `
    <header class="top">
      <div class="brand">
        <h1>Meet50</h1>
        <span>request → respond → concur</span>
      </div>
      <div class="pill ${paid ? "paid" : ""}">${paid ? "PAID" : "FREE"}</div>
    </header>
    <nav class="nav">
      <button data-go="#/home" class="${active === "home" ? "on" : ""}">Home<small>map + list</small></button>
      <button data-go="#/feed" class="${active === "feed" ? "on" : ""}">Feed<small>requests</small></button>
      <button data-go="#/me" class="${active === "me" ? "on" : ""}">Me<small>profile</small></button>
    </nav>
  `;
}

function bindNav() {
  document.querySelectorAll("[data-go]").forEach((b) => {
    b.onclick = () => go(b.getAttribute("data-go"));
  });
}

async function refreshMe() {
  if (!state.token) return null;
  try {
    const data = await api("GET", "/me");
    state.user = data.user;
    return data.user;
  } catch {
    state.token = "";
    localStorage.removeItem("meet50_token");
    state.user = null;
    return null;
  }
}

function welcomeView() {
  app.innerHTML = `
    <div class="hero">
      <div class="kicker">working title · 50-mile meetup</div>
      <h1>Not a swipe.<br/>A channel you both open.</h1>
      <p>Issue a request. Someone responds with a live camera photo. You concur. Then — and only then — you can text.</p>
      <div class="stack">
        <button class="btn" id="start">Create profile</button>
        <p class="hint">Free: looking-for filter and 30-minute expiry. Paid: age, distance, time, and you set expiry in minutes.</p>
      </div>
    </div>
  `;
  $("#start").onclick = () => go("#/signup");
}

function signupView() {
  app.innerHTML = `
    <div class="page">
      <div class="kicker">Signup profile · same fields for everyone</div>
      <h2 style="font-family:Fraunces,serif;margin:0 0 12px">Who you are</h2>
      <form class="stack card" id="form">
        <div class="grid-2">
          <label class="field">Name<input name="name" required /></label>
          <label class="field">Age<input name="age" type="number" min="18" max="99" required /></label>
        </div>
        <div class="grid-2">
          <label class="field">Gender
            <select name="gender" required>
              <option value="man">Male</option>
              <option value="woman">Female</option>
              <option value="nonbinary">LGBTQ</option>
            </select>
          </label>
          <label class="field">Marital status
            <select name="maritalStatus">
              <option value="single">Single</option>
              <option value="partnered">Partnered</option>
              <option value="married">Married</option>
              <option value="divorced">Divorced</option>
              <option value="prefer_not">Prefer not</option>
            </select>
          </label>
        </div>
        <div class="grid-2">
          <label class="field">Home city<input name="homeCity" required /></label>
          <label class="field">Job<input name="job" /></label>
        </div>
        <label class="field">Education
          <select name="education">${eduOptions("bachelor", false)}</select>
        </label>
        <label class="field">Bio<textarea name="bio" placeholder="A few lines. No pitch."></textarea></label>
        <label class="field">Looking for
          <select name="lookingFor">${lookingOptions("male", false)}</select>
        </label>
        <div class="kicker">Filter (saved)</div>
        <label class="field">Filter · looking for
          <select name="filterLookingFor">${lookingOptions("any", true)}</select>
        </label>
        <label class="field">Filter · education
          <select name="filterEducation">${eduOptions("any", true)}</select>
        </label>
        <div class="grid-2">
          <label class="field">Filter · age min<input name="filterAgeMin" type="number" min="18" max="99" value="18" /></label>
          <label class="field">Filter · age max<input name="filterAgeMax" type="number" min="18" max="99" value="99" /></label>
        </div>
        <label class="field">Filter · distance (miles, max 50)
          <input name="filterDistance" type="number" min="1" max="50" value="50" />
        </label>
        <button class="btn" type="submit">Enter Meet50</button>
        <div class="err" id="err"></div>
      </form>
    </div>
  `;
  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get("name"),
      age: Number(fd.get("age")),
      gender: fd.get("gender"),
      maritalStatus: fd.get("maritalStatus"),
      homeCity: fd.get("homeCity"),
      job: fd.get("job"),
      bio: fd.get("bio"),
      education: fd.get("education"),
      lookingFor: fd.get("lookingFor"),
      filter: {
        lookingFor: fd.get("filterLookingFor"),
        education: fd.get("filterEducation"),
        ageMin: Number(fd.get("filterAgeMin")),
        ageMax: Number(fd.get("filterAgeMax")),
        distance: Number(fd.get("filterDistance")),
      },
    };
    try {
      const data = await api("POST", "/signup", body);
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("meet50_token", data.token);
      go("#/home");
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

async function ensureLocation() {
  if (!state.user) return;
  if (state.user.lat != null) return;
  const set = async (lat, lon) => {
    const data = await api("PUT", "/me/location", { lat, lon });
    state.user = data.user;
  };
  if (!navigator.geolocation) {
    await set(47.6062, -122.3321);
    return;
  }
  await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await set(pos.coords.latitude, pos.coords.longitude);
        resolve();
      },
      async () => {
        await set(47.6062, -122.3321);
        resolve();
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

async function loadNearby() {
  await ensureLocation();
  state.nearby = await api("GET", "/nearby");
  if (state.user) {
    state.user = {
      ...state.user,
      ...state.nearby.me,
      preferences: state.user.preferences,
      filter: state.user.filter,
      education: state.user.education,
    };
  }
}

function drawMap(people) {
  const me = state.nearby?.me;
  const el = $("#map");
  if (!window.L || !el || me?.lat == null) return;
  if (state.map) {
    try {
      state.map.remove();
    } catch (_) {}
    state.map = null;
  }
  const map = L.map(el, { zoomControl: true }).setView([me.lat, me.lon], 10);
  state.map = map;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OSM",
    maxZoom: 18,
  }).addTo(map);
  const bounds = [[me.lat, me.lon]];
  L.circleMarker([me.lat, me.lon], {
    radius: 11,
    color: "#ff5a1f",
    fillColor: "#ff5a1f",
    fillOpacity: 1,
    weight: 2,
  })
    .addTo(map)
    .bindPopup("You");
  L.circle([me.lat, me.lon], {
    radius: 50 * 1609.34,
    color: "#ff5a1f",
    weight: 1,
    fillOpacity: 0.04,
  }).addTo(map);
  for (const p of people) {
    if (p.lat == null || p.lon == null) continue;
    bounds.push([p.lat, p.lon]);
    L.circleMarker([p.lat, p.lon], {
      radius: 9,
      color: "#ffd36a",
      fillColor: "#ffd36a",
      fillOpacity: 1,
      weight: 2,
    })
      .addTo(map)
      .bindPopup(`${esc(p.name)} · ${fmtMiles(p.miles)}`);
  }
  if (bounds.length > 1) {
    try {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
    } catch (_) {}
  }
  setTimeout(() => map.invalidateSize(), 80);
  setTimeout(() => map.invalidateSize(), 400);
}

function homeView() {
  const people = state.nearby?.people || [];
  const box = state.inbox || { channels: [], incoming: [] };
  app.innerHTML = `
    ${nav("home")}
    <div class="page">
      <div class="kicker">Active users · 50 miles</div>
      <div id="map"></div>
      <div class="row spread" style="margin:10px 0">
        <div class="hint">${people.length} active nearby. You are the orange pin.</div>
        <button class="btn ghost" id="relocate">Relocate</button>
      </div>
      <div class="kicker">List</div>
      <div class="stack" id="people"></div>
      <div class="kicker" style="margin-top:18px">Channels</div>
      <div class="stack" id="channels"></div>
    </div>
  `;
  bindNav();
  $("#relocate").onclick = async () => {
    state.user.lat = null;
    await ensureLocation();
    await loadNearby();
    render();
  };
  $("#people").innerHTML =
    people
      .map(
        (p) => `
      <div class="card person">
        ${avatar(p.lastPhoto, p.name)}
        <div>
          <div class="name">${esc(p.name)}, ${p.age}</div>
          <div class="meta">${esc(p.job)} · ${esc(p.homeCity)} · ${fmtMiles(p.miles)} · ${LOOKING_LABEL[p.lookingFor] || p.lookingFor || ""}</div>
        </div>
        <span class="tag">${p.active ? "active" : "stale"}</span>
      </div>`
      )
      .join("") || `<p class="hint">No other active users in the 50-mile fence yet.</p>`;
  $("#channels").innerHTML =
    (box.channels || [])
      .map(
        (c) => `
        <div class="card person" data-go="#/chat/${c.id}">
          ${avatar(c.other?.lastPhoto, c.other?.name)}
          <div>
            <div class="name">${esc(c.other?.name)}</div>
            <div class="meta">${esc(c.lastText)}</div>
          </div>
          <span class="tag">chat</span>
        </div>`
      )
      .join("") || `<p class="hint">No open channels. Concur a respond on Feed to unlock text.</p>`;
  document.querySelectorAll("#channels [data-go]").forEach((el) => {
    el.onclick = () => go(el.getAttribute("data-go"));
  });
  drawMap(people);
}

function feedView() {
  const meetups = state.nearby?.meetups || [];
  const paid = state.user?.plan === "paid";
  const pref = state.user?.preferences || {};
  const saved = state.user?.filter || {};
  const looking = pref.lookingFor || saved.lookingFor || "any";
  app.innerHTML = `
    ${nav("feed")}
    <div class="page">
      <div class="row spread">
        <div>
          <div class="kicker">Filter counterparties</div>
          <h2 style="font-family:Fraunces,serif;margin:0">Open meetups</h2>
        </div>
        <button class="btn" id="newReq">New request</button>
      </div>
      <form class="card stack" id="feedPrefs" style="margin-top:12px">
        <label class="field">Looking for
          <select name="lookingFor">${lookingOptions(looking, true)}</select>
        </label>
        <div class="${paid ? "" : "locked"}">
          <div class="grid-2">
            <label class="field">Age min<input name="ageMin" type="number" min="18" max="99" value="${pref.ageMin ?? saved.ageMin ?? 18}" ${paid ? "" : "disabled"} /></label>
            <label class="field">Age max<input name="ageMax" type="number" min="18" max="99" value="${pref.ageMax ?? saved.ageMax ?? 99}" ${paid ? "" : "disabled"} /></label>
          </div>
          <label class="field">Distance (miles, max 50)
            <input name="distanceMiles" type="range" min="1" max="50" value="${pref.distanceMiles ?? saved.distance ?? 50}" ${paid ? "" : "disabled"} />
            <span class="meta" id="distLabel">${pref.distanceMiles ?? saved.distance ?? 50} mi</span>
          </label>
          <label class="field">Education
            <select name="education" ${paid ? "" : "disabled"}>${eduOptions(pref.education ?? saved.education ?? "any", true)}</select>
          </label>
          <div class="grid-2">
            <label class="field">Time from<input name="timeFrom" type="datetime-local" value="${pref.timeFrom || ""}" ${paid ? "" : "disabled"} /></label>
            <label class="field">Time to<input name="timeTo" type="datetime-local" value="${pref.timeTo || ""}" ${paid ? "" : "disabled"} /></label>
          </div>
          ${paid ? "" : `<p class="hint">Free: looking-for only. Paid unlocks age, distance, education, and time.</p>`}
        </div>
        <button class="btn ghost" type="submit">Apply filter</button>
      </form>
      <div class="stack" style="margin-top:14px">
        ${
          meetups
            .map(
              (m) => `
          <div class="card meetup" data-open="#/request/${m.id}">
            ${avatar(m.livePhoto || m.user?.lastPhoto, m.user?.name)}
            <div>
              <div class="name">${esc(m.user?.name)} ${m.isMine ? "(you)" : ""}</div>
              <div class="meta">${m.intent} a ${m.kind} · ${fmtMiles(m.miles)} · ${fmtLeft(m.offerExpiresAt)}</div>
              <div class="hint">${esc(m.note)}</div>
            </div>
            <span class="tag">${m.intent}/${m.kind}</span>
          </div>`
            )
            .join("") || `<p class="hint">Nothing open in your fence. Be the initiator.</p>`
        }
      </div>
    </div>
  `;
  bindNav();
  $("#newReq").onclick = () => go("#/new");
  const range = $("[name=distanceMiles]");
  if (range) range.oninput = () => ($("#distLabel").textContent = range.value + " mi");
  $("#feedPrefs").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { lookingFor: fd.get("lookingFor") };
    if (paid) {
      body.ageMin = Number(fd.get("ageMin"));
      body.ageMax = Number(fd.get("ageMax"));
      body.distanceMiles = Number(fd.get("distanceMiles"));
      body.education = fd.get("education");
      body.timeFrom = fd.get("timeFrom");
      body.timeTo = fd.get("timeTo");
    }
    const data = await api("PUT", "/me/preferences", body);
    state.user = data.user;
    await loadNearby();
    feedView();
  };
  document.querySelectorAll("[data-open]").forEach((el) => {
    el.onclick = () => go(el.getAttribute("data-open"));
  });
}

function cameraMarkup() {
  return `
    <div class="card stack">
      <div class="kicker">Live camera gate</div>
      <p class="hint">Gallery is rejected. Capture from this camera to post or respond. That shot becomes your last profile photo.</p>
      <div class="camera"><video id="cam" autoplay playsinline></video></div>
      <div class="row">
        <button class="btn ghost" type="button" id="startCam">Open camera</button>
        <button class="btn" type="button" id="snap" disabled>Capture live photo</button>
      </div>
      <div id="shot"></div>
    </div>
  `;
}

async function wireCamera() {
  const video = $("#cam");
  const snap = $("#snap");
  const start = $("#startCam");
  if (!start) return;
  start.onclick = async () => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" }, width: { ideal: 720 } },
        audio: false,
      });
      state.cameraStream = stream;
      video.srcObject = stream;
      snap.disabled = false;
    } catch (err) {
      alert("Camera blocked: " + err.message + ". Use localhost or HTTPS.");
    }
  };
  snap.onclick = async () => {
    if (!state.cameraStream) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 960;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const image = canvas.toDataURL("image/jpeg", 0.85);
    const data = await api("POST", "/photos/live", { image, capturedAt: Date.now() });
    state.photoId = data.photoId;
    state.user = data.user;
    stopCamera();
    $("#shot").innerHTML = `<img src="${data.url}" alt="live capture" style="border-radius:12px;max-height:240px;object-fit:cover" /><p class="hint">Live photo saved as last profile photo.</p>`;
  };
}

function newRequestView() {
  const paid = state.user?.plan === "paid";
  app.innerHTML = `
    ${nav("feed")}
    <div class="page">
      <div class="kicker">Offer or ask</div>
      <h2 style="font-family:Fraunces,serif;margin:0 0 12px">Post a meetup</h2>
      ${cameraMarkup()}
      <form class="card stack" id="form">
        <div class="grid-2">
          <label class="field">Intent
            <select name="intent">
              <option value="offer">Offer (I buy)</option>
              <option value="ask">Ask (you buy)</option>
            </select>
          </label>
          <label class="field">Kind
            <select name="kind">
              <option value="drink">Drink</option>
              <option value="meal">Meal</option>
            </select>
          </label>
        </div>
        <label class="field">Note<input name="note" maxlength="280" placeholder="Where / when, keep it short" /></label>
        <label class="field">Offer/ask expiry (minutes) ${paid ? "" : "· locked at 30 for free"}
          <input name="expireMinutes" type="number" min="1" max="10080" step="1" value="30" ${paid ? "" : "disabled"} />
        </label>
        <button class="btn" type="submit">Post request</button>
        <div class="err" id="err"></div>
      </form>
    </div>
  `;
  bindNav();
  wireCamera();
  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    if (!state.photoId) {
      $("#err").textContent = "live_photo_required — capture from the camera first.";
      return;
    }
    const fd = new FormData(e.target);
    const body = {
      intent: fd.get("intent"),
      kind: fd.get("kind"),
      note: fd.get("note"),
      photoId: state.photoId,
    };
    if (paid) body.expireMinutes = Number(fd.get("expireMinutes") || 30);
    try {
      const data = await api("POST", "/meetups", body);
      state.photoId = null;
      go("#/request/" + data.meetup.id);
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

function meetupView() {
  const m = state.meetup;
  if (!m) return;
  const canRespond = !m.isMine && m.status === "open";
  const canConcur = m.isMine && m.status === "open";
  app.innerHTML = `
    ${nav("feed")}
    <div class="page">
      <div class="kicker">Request</div>
      <div class="card">
        <div class="row">
          ${avatar(m.livePhoto, m.user?.name)}
          <div>
            <div class="name">${esc(m.user?.name)}, ${m.user?.age}</div>
            <div class="meta">${m.intent} a ${m.kind} · ${fmtMiles(m.miles)} · ${m.status}</div>
            <div class="countdown">Offer ${fmtLeft(m.offerExpiresAt)}</div>
            <p>${esc(m.note)}</p>
          </div>
        </div>
      </div>
      ${m.channelId ? `<button class="btn" id="openChat">Open channel chat</button>` : ""}
      ${
        canRespond
          ? `${cameraMarkup()}<form class="card stack" id="resp">
              <label class="field">Note<input name="note" maxlength="280" /></label>
              <button class="btn" type="submit">Respond (camera required)</button>
              <div class="err" id="err"></div>
            </form>`
          : ""
      }
      <div class="kicker" style="margin-top:18px">Responds — initiator concurs to open a channel</div>
      <div class="stack">
        ${
          (m.responds || [])
            .map(
              (r) => `
          <div class="card">
            <div class="row spread">
              <div class="row">
                ${avatar(r.livePhoto || r.user?.lastPhoto, r.user?.name)}
                <div>
                  <div class="name">${esc(r.user?.name)}</div>
                  <div class="meta">${r.status} · ${fmtLeft(r.expiresAt)}</div>
                  <div class="hint">${esc(r.note)}</div>
                </div>
              </div>
              ${
                canConcur && r.status === "pending"
                  ? `<button class="btn ok" data-concur="${r.id}">Concur</button>`
                  : ""
              }
            </div>
          </div>`
            )
            .join("") || `<p class="hint">No responds yet. Nearby demo users typically answer in ~10s.</p>`
        }
      </div>
    </div>
  `;
  bindNav();
  const chatBtn = $("#openChat");
  if (chatBtn) chatBtn.onclick = () => go("#/chat/" + m.channelId);
  if (canRespond) {
    wireCamera();
    $("#resp").onsubmit = async (e) => {
      e.preventDefault();
      if (!state.photoId) {
        $("#err").textContent = "live_photo_required";
        return;
      }
      try {
        const fd = new FormData(e.target);
        const data = await api("POST", `/meetups/${m.id}/responds`, {
          photoId: state.photoId,
          note: fd.get("note"),
        });
        state.meetup = data.meetup;
        state.photoId = null;
        meetupView();
      } catch (err) {
        $("#err").textContent = err.message;
      }
    };
  }
  document.querySelectorAll("[data-concur]").forEach((b) => {
    b.onclick = async () => {
      try {
        const data = await api("POST", `/meetups/${m.id}/concur`, { respondId: b.getAttribute("data-concur") });
        go("#/chat/" + data.channelId);
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

function bubbleHtml(m) {
  return `<div class="bubble ${m.system ? "sys" : m.isMine ? "mine" : ""}" data-id="${esc(m.id)}">${esc(m.text)}</div>`;
}

function paintChatLog(messages) {
  const log = $("#log");
  if (!log) return;
  const html = (messages || []).map(bubbleHtml).join("");
  if (log.getAttribute("data-sig") === html) return;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.innerHTML = html;
  log.setAttribute("data-sig", html);
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function chatView() {
  const c = state.chat;
  if (!c) return;
  app.innerHTML = `
    ${nav("home")}
    <div class="page">
      <div class="kicker">Text chat after channel</div>
      <div class="row" style="margin-bottom:10px">
        ${avatar(c.other?.lastPhoto, c.other?.name)}
        <div>
          <div class="name">${esc(c.other?.name)}</div>
          <div class="meta">Channel ${(c.channelId || "").slice(-6)}</div>
        </div>
      </div>
      <div class="chat" id="log">${(c.messages || []).map(bubbleHtml).join("")}</div>
      <form class="composer" id="chatForm">
        <input id="chatInput" name="text" maxlength="1000" placeholder="Message" autocomplete="off" />
        <button class="btn" type="submit">Send</button>
      </form>
      <div class="err" id="chatErr"></div>
    </div>
  `;
  bindNav();
  const log = $("#log");
  log.scrollTop = log.scrollHeight;
  $("#chatForm").onsubmit = async (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const text = (input.value || "").trim();
    if (!text) return;
    input.value = "";
    try {
      const sent = await api("POST", `/channels/${c.channelId}/messages`, { text });
      state.chat.messages = state.chat.messages || [];
      state.chat.messages.push(sent.message);
      if (sent.reply) state.chat.messages.push(sent.reply);
      paintChatLog(state.chat.messages);
      input.focus();
    } catch (err) {
      $("#chatErr").textContent = err.message;
      input.value = text;
    }
  };
}

function meView() {
  const u = state.user;
  const paid = u.plan === "paid";
  const filt = u.filter || {};
  app.innerHTML = `
    ${nav("me")}
    <div class="page">
      <form class="card stack" id="profile">
        <div class="kicker">Profile · same for free and paid</div>
        <div class="row">${avatar(u.lastPhoto, u.name)}<div class="hint">Last photo is the live camera capture from post/respond.</div></div>
        <div class="grid-2">
          <label class="field">Name<input name="name" value="${esc(u.name || "")}" required /></label>
          <label class="field">Age<input name="age" type="number" min="18" max="99" value="${u.age || ""}" required /></label>
        </div>
        <div class="grid-2">
          <label class="field">Gender
            <select name="gender">
              <option value="man" ${u.gender === "man" ? "selected" : ""}>Male</option>
              <option value="woman" ${u.gender === "woman" ? "selected" : ""}>Female</option>
              <option value="nonbinary" ${u.gender === "nonbinary" ? "selected" : ""}>LGBTQ</option>
            </select>
          </label>
          <label class="field">Marital status
            <select name="maritalStatus">
              <option value="single" ${u.maritalStatus === "single" ? "selected" : ""}>Single</option>
              <option value="partnered" ${u.maritalStatus === "partnered" ? "selected" : ""}>Partnered</option>
              <option value="married" ${u.maritalStatus === "married" ? "selected" : ""}>Married</option>
              <option value="divorced" ${u.maritalStatus === "divorced" ? "selected" : ""}>Divorced</option>
              <option value="prefer_not" ${u.maritalStatus === "prefer_not" ? "selected" : ""}>Prefer not</option>
            </select>
          </label>
        </div>
        <div class="grid-2">
          <label class="field">Home city<input name="homeCity" value="${esc(u.homeCity || "")}" /></label>
          <label class="field">Job<input name="job" value="${esc(u.job || "")}" /></label>
        </div>
        <label class="field">Education
          <select name="education">${eduOptions(u.education || "bachelor", false)}</select>
        </label>
        <label class="field">Bio<textarea name="bio">${esc(u.bio || "")}</textarea></label>
        <label class="field">Looking for
          <select name="lookingFor">${lookingOptions(u.lookingFor || "male", false)}</select>
        </label>
        <div class="kicker">Filter</div>
        <label class="field">Looking for
          <select name="filterLookingFor">${lookingOptions(filt.lookingFor || "any", true)}</select>
        </label>
        <label class="field">Education
          <select name="filterEducation">${eduOptions(filt.education || "any", true)}</select>
        </label>
        <div class="grid-2">
          <label class="field">Age min<input name="filterAgeMin" type="number" min="18" max="99" value="${filt.ageMin ?? 18}" /></label>
          <label class="field">Age max<input name="filterAgeMax" type="number" min="18" max="99" value="${filt.ageMax ?? 99}" /></label>
        </div>
        <label class="field">Distance (miles, max 50)
          <input name="filterDistance" type="number" min="1" max="50" value="${filt.distance ?? 50}" />
        </label>
        <button class="btn" type="submit">Save profile</button>
        <div class="err" id="err"></div>
      </form>
      <div class="card stack">
        <div class="kicker">Plan</div>
        <p class="hint">Free vs paid only changes Feed selectors and expiry. Profile fields stay the same.</p>
        ${
          paid
            ? `<button class="btn ghost" id="downgrade">Revert to free (demo)</button>`
            : `<button class="btn warn" id="upgrade">Unlock paid (demo entitlement)</button>`
        }
      </div>
    </div>
  `;
  bindNav();
  const up = $("#upgrade");
  const down = $("#downgrade");
  if (up)
    up.onclick = async () => {
      state.user = (await api("POST", "/me/plan", { plan: "paid" })).user;
      meView();
    };
  if (down)
    down.onclick = async () => {
      state.user = (await api("POST", "/me/plan", { plan: "free" })).user;
      meView();
    };
  $("#profile").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api("PUT", "/me", {
        name: fd.get("name"),
        age: Number(fd.get("age")),
        gender: fd.get("gender"),
        maritalStatus: fd.get("maritalStatus"),
        homeCity: fd.get("homeCity"),
        job: fd.get("job"),
        bio: fd.get("bio"),
        education: fd.get("education"),
        lookingFor: fd.get("lookingFor"),
        filter: {
          lookingFor: fd.get("filterLookingFor"),
          education: fd.get("filterEducation"),
          ageMin: Number(fd.get("filterAgeMin")),
          ageMax: Number(fd.get("filterAgeMax")),
          distance: Number(fd.get("filterDistance")),
        },
      });
      state.user = data.user;
      $("#err").textContent = "Saved.";
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

async function render() {
  const { parts } = route();
  const page = parts[0] || "";
  if (!state.token && page !== "signup") {
    welcomeView();
    return;
  }
  if (page === "signup") {
    signupView();
    return;
  }
  if (!state.user) await refreshMe();
  if (!state.user) {
    welcomeView();
    return;
  }

  try {
    if (page === "new") {
      newRequestView();
      return;
    }
    if (page === "request" && parts[1]) {
      const data = await api("GET", "/meetups/" + parts[1]);
      state.meetup = data.meetup;
      meetupView();
      if (!state.poll) {
        state.poll = setInterval(async () => {
          if (state.cameraStream) return;
          const fresh = await api("GET", "/meetups/" + parts[1]);
          state.meetup = fresh.meetup;
          const keepPhoto = state.photoId;
          meetupView();
          state.photoId = keepPhoto;
        }, 4000);
      }
      return;
    }
    if (page === "chat" && parts[1]) {
      state.chat = await api("GET", "/channels/" + parts[1] + "/messages");
      chatView();
      if (!state.poll) {
        const cid = parts[1];
        state.poll = setInterval(async () => {
          try {
            const fresh = await api("GET", "/channels/" + cid + "/messages");
            state.chat = fresh;
            paintChatLog(fresh.messages);
          } catch (_) {}
        }, 2000);
      }
      return;
    }
    if (page === "me") {
      await refreshMe();
      meView();
      return;
    }
    if (page === "feed") {
      await loadNearby();
      feedView();
      return;
    }
    await loadNearby();
    try {
      state.inbox = await api("GET", "/inbox");
    } catch (_) {
      state.inbox = { channels: [] };
    }
    homeView();
  } catch (err) {
    app.innerHTML = `${nav("home")}<div class="page"><p class="err">${esc(err.message)}</p></div>`;
    bindNav();
  }
}

window.addEventListener("hashchange", () => {
  stopCamera();
  if (state.poll) {
    clearInterval(state.poll);
    state.poll = null;
  }
  render();
});

render();
