(() => {
  "use strict";

  const API = "https://api.mail.gw";
  const SESSION_KEY = "tempmail-web-session-v1";
  const INBOX_LIFETIME = 10 * 60 * 1000;
  const POLL_INTERVAL = 12 * 1000;

  const state = {
    folder: "inbox",
    inboxes: [],
    selectedInbox: null,
    messages: [],
    selectedMessage: null,
    messageDetails: new Map(),
    remoteImagesLoaded: false,
    syncing: false,
  };

  const $ = id => document.getElementById(id);
  const els = {
    refreshBtn: $("refreshBtn"), advancedBtn: $("advancedBtn"), newInboxBtn: $("newInboxBtn"),
    inboxTab: $("inboxTab"), archiveTab: $("archiveTab"), inboxCount: $("inboxCount"),
    archiveCount: $("archiveCount"), mailboxList: $("mailboxList"), selectedAddress: $("selectedAddress"),
    copyAddressBtn: $("copyAddressBtn"), archiveBtn: $("archiveBtn"), messagePaneTitle: $("messagePaneTitle"),
    messagePaneSubtitle: $("messagePaneSubtitle"), messageCount: $("messageCount"), messageList: $("messageList"),
    readerEmpty: $("readerEmpty"), readerContent: $("readerContent"), subject: $("subject"),
    messageMeta: $("messageMeta"), attachmentBar: $("attachmentBar"), imageNotice: $("imageNotice"),
    loadImagesBtn: $("loadImagesBtn"), emailFrame: $("emailFrame"), usernameInput: $("usernameInput"),
    createInboxBtn: $("createInboxBtn"), randomChoice: $("randomChoice"), customChoice: $("customChoice"),
    usernameField: $("usernameField"), toastRegion: $("toastRegion"), destroyAllBtn: $("destroyAllBtn"),
  };

  function collection(data) {
    if (Array.isArray(data)) return data;
    return data?.["hydra:member"] || data?.member || data?.items || [];
  }

  async function provider(path, { method = "GET", body, token, raw = false } = {}) {
    const headers = { Accept: raw ? "*/*" : "application/ld+json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${API}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store",
    });
    if (!response.ok) {
      let detail = {};
      try { detail = await response.json(); } catch (_) {}
      throw new Error(detail["hydra:description"] || detail.message || `Mail service error (${response.status})`);
    }
    if (raw) return response;
    if (response.status === 204) return null;
    return response.json();
  }

  function loadSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]");
      state.inboxes = Array.isArray(saved) ? saved.filter(validInbox) : [];
    } catch (_) { state.inboxes = []; }
  }

  function saveSession() {
    const safe = state.inboxes.map(({ id, accountId, address, password, token, archived, expiresAt }) =>
      ({ id, accountId, address, password, token, archived: !!archived, expiresAt }));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(safe));
  }

  function validInbox(inbox) {
    return inbox && inbox.id && inbox.accountId && inbox.address && inbox.password && inbox.token && inbox.expiresAt;
  }

  function randomUsername() {
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    return "temp-" + [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function toast(message, type = "info") {
    const div = document.createElement("div");
    div.className = `toast ${type === "error" ? "error" : ""}`;
    div.textContent = message;
    els.toastRegion.appendChild(div);
    setTimeout(() => div.remove(), 4200);
  }

  function setBusy(button, busy, text = "Working…") {
    if (busy) { button.dataset.originalText = button.textContent; button.textContent = text; button.disabled = true; }
    else { button.textContent = button.dataset.originalText || button.textContent; button.disabled = false; }
  }

  function modal(id, show = true) { $(id)?.classList.toggle("hidden", !show); }
  function formatDate(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  function formatFullDate(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  function remaining(inbox) { const s = Math.max(0, Math.ceil((inbox.expiresAt - Date.now()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  function visibleInboxes() { return state.inboxes.filter(inbox => !!inbox.archived === (state.folder === "archive")); }

  function normalizeSummary(item) {
    return {
      id: item.id, subject: item.subject || "(no subject)",
      sender_name: item.from?.name || "", sender_address: item.from?.address || "",
      created_at: item.createdAt || item.created_at || "", intro: item.intro || "",
      has_attachments: !!(item.hasAttachments || item.has_attachments), raw: item,
    };
  }

  function normalizeDetail(item) {
    const senderName = item.from?.name || "", senderAddress = item.from?.address || "";
    const recipients = (item.to || []).map(entry => entry.address || entry.name).filter(Boolean).join(", ");
    const htmlParts = Array.isArray(item.html) ? item.html : item.html ? [item.html] : [];
    return {
      id: item.id, subject: item.subject || "(no subject)",
      sender: senderName && senderAddress ? `${senderName} <${senderAddress}>` : senderName || senderAddress || "Unknown",
      recipients, created_at: item.createdAt || item.created_at || "", html: htmlParts[0] || "",
      text: item.text || item.intro || "", attachments: Array.isArray(item.attachments) ? item.attachments : [],
    };
  }

  function renderAll() {
    const active = state.inboxes.filter(inbox => !inbox.archived).length;
    const archived = state.inboxes.length - active;
    els.inboxCount.textContent = active; els.archiveCount.textContent = archived;
    els.inboxTab.classList.toggle("active", state.folder === "inbox");
    els.archiveTab.classList.toggle("active", state.folder === "archive");
    renderMailboxes(); renderSelectedInbox(); renderMessages(); renderReader();
  }

  function renderMailboxes() {
    els.mailboxList.replaceChildren();
    const inboxes = visibleInboxes();
    if (!inboxes.length) {
      const empty = document.createElement("div"); empty.className = "empty-list";
      empty.textContent = state.folder === "inbox" ? "No active inboxes yet. Create one when you need it." : "Nothing archived.";
      els.mailboxList.appendChild(empty); return;
    }
    for (const inbox of inboxes) {
      const button = document.createElement("button"); button.type = "button"; button.className = "mailbox-item";
      if (state.selectedInbox?.id === inbox.id) button.classList.add("active");
      const local = inbox.address.split("@")[0];
      button.innerHTML = `<span class="mailbox-local">${escapeHtml(local)} <small style="display:block;font-weight:500;opacity:.65">${remaining(inbox)} left</small></span><span class="mailbox-msg-count">${inbox.message_count || 0}</span>`;
      button.addEventListener("click", () => selectInbox(inbox.id)); els.mailboxList.appendChild(button);
    }
  }

  function renderSelectedInbox() {
    const inbox = state.selectedInbox;
    els.selectedAddress.textContent = inbox ? `${inbox.address} · ${remaining(inbox)} left` : "No inbox selected";
    els.copyAddressBtn.disabled = !inbox; els.archiveBtn.disabled = !inbox;
    els.archiveBtn.textContent = state.folder === "archive" ? "Restore" : "Archive";
    els.messagePaneTitle.textContent = inbox ? inbox.address.split("@")[0] : "Messages";
    els.messagePaneSubtitle.textContent = inbox ? inbox.address : "Select an inbox";
  }

  function renderMessages() {
    els.messageList.replaceChildren();
    els.messageCount.textContent = state.messages.length ? `${state.messages.length} ${state.messages.length === 1 ? "message" : "messages"}` : "";
    if (!state.selectedInbox) return;
    if (!state.messages.length) { const empty = document.createElement("div"); empty.className = "empty-list"; empty.textContent = "No messages yet. tempMail checks automatically."; els.messageList.appendChild(empty); return; }
    for (const msg of state.messages) {
      const button = document.createElement("button"); button.type = "button"; button.className = "message-item";
      if (state.selectedMessage?.id === msg.id) button.classList.add("active");
      button.innerHTML = `<span class="message-subject">${escapeHtml(msg.subject)}${msg.has_attachments ? '<span class="paperclip">⌕</span>' : ""}</span><span class="message-sender">${escapeHtml(msg.sender_name || msg.sender_address || "Unknown")}</span><span class="message-date">${escapeHtml(formatDate(msg.created_at))}</span>`;
      button.addEventListener("click", () => selectMessage(msg.id)); els.messageList.appendChild(button);
    }
  }

  function sanitizeEmail(source, loadImages) {
    const doc = new DOMParser().parseFromString(source, "text/html");
    doc.querySelectorAll("script,iframe,frame,object,embed,form,input,button,textarea,select,meta,base").forEach(node => node.remove());
    let hasRemote = false;
    doc.querySelectorAll("*").forEach(node => {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase(), value = attr.value.trim();
        if (name.startsWith("on") || name === "srcset") node.removeAttribute(attr.name);
        if (name === "style" && /url\s*\(/i.test(value)) node.removeAttribute("style");
        if ((name === "href" || name === "src") && !/^(https?:|mailto:|data:image\/)/i.test(value)) node.removeAttribute(attr.name);
        if (name === "src" && /^https?:/i.test(value) && !loadImages) { hasRemote = true; node.removeAttribute("src"); }
      }
      if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
    });
    doc.querySelectorAll("style").forEach(style => { style.textContent = style.textContent.replace(/@import[^;]+;?/gi, "").replace(/url\s*\([^)]*\)/gi, "none"); });
    const policy = loadImages ? "img-src https: http: data:" : "img-src data:";
    return { hasRemote, html: `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${policy}; style-src 'unsafe-inline';"><style>body{font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033;margin:20px;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#3558c9}</style>${doc.documentElement.innerHTML}` };
  }

  function renderReader() {
    const msg = state.selectedMessage;
    if (!msg) { els.readerEmpty.classList.remove("hidden"); els.readerContent.classList.add("hidden"); els.emailFrame.removeAttribute("srcdoc"); return; }
    els.readerEmpty.classList.add("hidden"); els.readerContent.classList.remove("hidden"); els.subject.textContent = msg.subject;
    els.messageMeta.textContent = [`From: ${msg.sender}`, `To: ${msg.recipients || "this inbox"}`, formatFullDate(msg.created_at)].filter(Boolean).join("\n");
    els.messageMeta.style.whiteSpace = "pre-line"; els.attachmentBar.replaceChildren();
    for (const attachment of msg.attachments) {
      const button = document.createElement("button"); button.className = "attachment-chip"; button.type = "button";
      button.textContent = `↧ ${attachment.filename || "Attachment"}`; button.addEventListener("click", () => downloadAttachment(attachment)); els.attachmentBar.appendChild(button);
    }
    els.attachmentBar.classList.toggle("hidden", !msg.attachments.length);
    const source = msg.html || `<pre style="white-space:pre-wrap">${escapeHtml(msg.text || "This message has no readable body.")}</pre>`;
    const safe = sanitizeEmail(source, state.remoteImagesLoaded);
    els.imageNotice.classList.toggle("hidden", !safe.hasRemote || state.remoteImagesLoaded); els.emailFrame.srcdoc = safe.html;
    renderMessages();
  }

  async function createInbox() {
    const mode = document.querySelector('input[name="usernameMode"]:checked')?.value || "random";
    const requested = mode === "custom" ? els.usernameInput.value.trim() : "";
    if (requested && !/^[A-Za-z0-9._-]{1,64}$/.test(requested)) return toast("Username may use letters, numbers, dots, underscores, and hyphens.", "error");
    setBusy(els.createInboxBtn, true, "Creating…");
    try {
      const domainData = await provider("/domains?page=1");
      const domains = collection(domainData).filter(domain => domain.isActive !== false).map(domain => domain.domain).filter(Boolean);
      if (!domains.length) throw new Error("No temporary-mail domain is available right now.");
      const password = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      let account = null, address = "", lastError = null;
      const attempts = requested ? domains.map(domain => `${requested}@${domain}`) : Array.from({ length: 5 }, (_, index) => `${randomUsername()}@${domains[index % domains.length]}`);
      for (const candidate of attempts) {
        try { account = await provider("/accounts", { method: "POST", body: { address: candidate, password } }); address = candidate; break; }
        catch (error) { lastError = error; if (!/409|422|already|used|exist/i.test(error.message)) throw error; }
      }
      if (!account) throw lastError || new Error("Could not create a temporary inbox.");
      const tokenData = await provider("/token", { method: "POST", body: { address, password } });
      const inbox = { id: account.id, accountId: account.id, address, password, token: tokenData.token, archived: false, expiresAt: Date.now() + INBOX_LIFETIME, message_count: 0 };
      state.inboxes.unshift(inbox); saveSession(); state.folder = "inbox"; state.selectedInbox = inbox; state.messages = []; state.selectedMessage = null;
      modal("newInboxModal", false); els.usernameInput.value = ""; renderAll();
      try { await navigator.clipboard.writeText(address); toast(`${address} created and copied.`); } catch (_) { toast(`${address} created.`); }
    } catch (error) { toast(error.message || "Could not create an inbox.", "error"); }
    finally { setBusy(els.createInboxBtn, false); }
  }

  async function syncSelected({ quiet = false } = {}) {
    const inbox = state.selectedInbox;
    if (!inbox || inbox.archived || state.syncing) return;
    state.syncing = true; if (!quiet) setBusy(els.refreshBtn, true, "Refreshing…");
    try {
      const data = await provider("/messages?page=1", { token: inbox.token });
      const next = collection(data).map(normalizeSummary); const previous = inbox.message_count || 0;
      inbox.message_count = next.length; state.messages = next; saveSession(); renderAll();
      if (!quiet) toast(next.length > previous ? `${next.length - previous} new message${next.length - previous === 1 ? "" : "s"}.` : "Inbox is up to date.");
    } catch (error) { if (!quiet) toast(`${error.message} Existing messages are unchanged.`, "error"); }
    finally { state.syncing = false; if (!quiet) setBusy(els.refreshBtn, false); }
  }

  async function selectInbox(id) {
    const inbox = state.inboxes.find(item => item.id === id); if (!inbox) return;
    state.selectedInbox = inbox; state.messages = []; state.selectedMessage = null; state.remoteImagesLoaded = false; renderAll();
    if (!inbox.archived) await syncSelected({ quiet: true });
  }

  async function selectMessage(id) {
    if (!state.selectedInbox) return;
    try {
      let detail = state.messageDetails.get(id);
      if (!detail) { detail = normalizeDetail(await provider(`/messages/${encodeURIComponent(id)}`, { token: state.selectedInbox.token })); state.messageDetails.set(id, detail); }
      state.selectedMessage = detail; state.remoteImagesLoaded = false; renderReader();
    } catch (error) { toast(error.message || "Could not open message.", "error"); }
  }

  async function downloadAttachment(attachment) {
    if (!state.selectedInbox || !state.selectedMessage) return;
    try {
      const path = attachment.downloadUrl || `/messages/${encodeURIComponent(state.selectedMessage.id)}/attachment/${encodeURIComponent(attachment.id)}`;
      const response = await provider(path.startsWith("http") ? path.slice(API.length) : path, { token: state.selectedInbox.token, raw: true });
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a");
      anchor.href = url; anchor.download = attachment.filename || "attachment"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast(error.message || "Attachment download failed.", "error"); }
  }

  async function archiveSelected() {
    if (!state.selectedInbox) return; state.selectedInbox.archived = state.folder !== "archive"; saveSession();
    toast(state.selectedInbox.archived ? "Inbox archived for this session." : "Inbox restored."); state.selectedInbox = null; state.messages = []; state.selectedMessage = null; renderAll();
  }

  async function deleteInbox(inbox, notify = false) {
    state.inboxes = state.inboxes.filter(item => item.id !== inbox.id); if (state.selectedInbox?.id === inbox.id) { state.selectedInbox = null; state.messages = []; state.selectedMessage = null; }
    saveSession(); renderAll();
    try { await provider(`/accounts/${encodeURIComponent(inbox.accountId)}`, { method: "DELETE", token: inbox.token }); }
    catch (_) {}
    if (notify) toast(`${inbox.address} was destroyed.`);
  }

  async function purgeExpired() {
    const expired = state.inboxes.filter(inbox => inbox.expiresAt <= Date.now());
    for (const inbox of expired) await deleteInbox(inbox, true);
    if (!expired.length) { renderMailboxes(); renderSelectedInbox(); }
  }

  async function destroyAll() {
    if (!state.inboxes.length) return toast("There are no inboxes to destroy.");
    if (!confirm("Destroy every temporary inbox in this tab now?")) return;
    const inboxes = [...state.inboxes]; state.inboxes = []; state.selectedInbox = null; state.messages = []; state.selectedMessage = null; saveSession(); renderAll(); modal("advancedDrawer", false);
    await Promise.allSettled(inboxes.map(inbox => provider(`/accounts/${encodeURIComponent(inbox.accountId)}`, { method: "DELETE", token: inbox.token })));
    toast("All temporary inboxes were destroyed.");
  }

  function updateUsernameMode() {
    const custom = document.querySelector('input[name="usernameMode"]:checked')?.value === "custom";
    els.usernameField.classList.toggle("hidden", !custom); els.randomChoice.classList.toggle("selected", !custom); els.customChoice.classList.toggle("selected", custom);
    if (custom) setTimeout(() => els.usernameInput.focus(), 40);
  }

  function setupEvents() {
    els.inboxTab.addEventListener("click", () => { state.folder = "inbox"; state.selectedInbox = null; state.messages = []; state.selectedMessage = null; renderAll(); });
    els.archiveTab.addEventListener("click", () => { state.folder = "archive"; state.selectedInbox = null; state.messages = []; state.selectedMessage = null; renderAll(); });
    els.refreshBtn.addEventListener("click", () => state.selectedInbox ? syncSelected() : toast("Select an inbox first."));
    els.copyAddressBtn.addEventListener("click", async () => { if (!state.selectedInbox) return; try { await navigator.clipboard.writeText(state.selectedInbox.address); toast("Address copied."); } catch (_) { toast(state.selectedInbox.address); } });
    els.archiveBtn.addEventListener("click", archiveSelected); els.advancedBtn.addEventListener("click", () => modal("advancedDrawer", true));
    els.newInboxBtn.addEventListener("click", () => { modal("newInboxModal", true); document.querySelector('input[name="usernameMode"][value="random"]').checked = true; updateUsernameMode(); });
    document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => modal(button.dataset.close, false)));
    document.querySelectorAll('input[name="usernameMode"]').forEach(input => input.addEventListener("change", updateUsernameMode));
    els.createInboxBtn.addEventListener("click", createInbox); els.usernameInput.addEventListener("keydown", event => { if (event.key === "Enter") createInbox(); });
    els.loadImagesBtn.addEventListener("click", () => { state.remoteImagesLoaded = true; renderReader(); }); els.destroyAllBtn.addEventListener("click", destroyAll);
    window.addEventListener("keydown", event => { if (event.key === "Escape") { modal("newInboxModal", false); modal("advancedDrawer", false); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); modal("newInboxModal", true); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") { event.preventDefault(); syncSelected(); } });
  }

  async function init() {
    setupEvents(); updateUsernameMode(); loadSession(); await purgeExpired();
    const first = visibleInboxes()[0]; if (first) await selectInbox(first.id); else renderAll();
    setInterval(purgeExpired, 1000); setInterval(() => syncSelected({ quiet: true }), POLL_INTERVAL);
  }
  init().catch(error => toast(error.message || "tempMail could not start.", "error"));
})();
