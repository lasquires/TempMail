(() => {
  "use strict";

  const API = "https://api.mail.gw";
  const SESSION_KEY = "tempmail-current-inbox";
  const POLL_MS = 10000;

  const $ = id => document.getElementById(id);
  const els = {
    address: $("address"), copyBtn: $("copyBtn"), refreshBtn: $("refreshBtn"), newBtn: $("newBtn"),
    count: $("count"), messageList: $("messageList"), readerEmpty: $("readerEmpty"),
    readerContent: $("readerContent"), subject: $("subject"), meta: $("meta"),
    attachments: $("attachments"), emailFrame: $("emailFrame"), status: $("status"),
  };

  let inbox = null;
  let messages = [];
  let selectedId = null;
  let syncing = false;

  function list(data) {
    if (Array.isArray(data)) return data;
    return data?.["hydra:member"] || data?.member || data?.items || [];
  }

  async function api(path, { method = "GET", body, token, raw = false } = {}) {
    const headers = { Accept: raw ? "*/*" : "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${API}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store",
    });
    if (!response.ok) {
      let detail = {};
      try { detail = await response.json(); } catch (_) {}
      const error = new Error(detail["hydra:description"] || detail.message || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    if (raw) return response;
    if (response.status === 204) return null;
    return response.json();
  }

  function setStatus(text, error = false) {
    els.status.textContent = text;
    els.status.style.color = error ? "#b42318" : "";
  }

  function randomName() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return "mail-" + [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function loadInbox() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (saved?.id && saved?.address && saved?.token && saved?.password) inbox = saved;
    } catch (_) { sessionStorage.removeItem(SESSION_KEY); }
  }

  function saveInbox() {
    if (inbox) sessionStorage.setItem(SESSION_KEY, JSON.stringify(inbox));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  async function createInbox() {
    els.newBtn.disabled = true; els.refreshBtn.disabled = true; els.copyBtn.disabled = true;
    els.address.textContent = "Creating inbox…"; setStatus("Creating inbox…");
    const oldInbox = inbox;
    try {
      const domains = list(await api("/domains?page=1")).filter(item => item.isActive !== false && item.domain);
      if (!domains.length) throw new Error("No email domain is available. Try again.");

      const password = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      let account = null, address = "", lastError = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        address = `${randomName()}@${domains[attempt % domains.length].domain}`;
        try {
          account = await api("/accounts", { method: "POST", body: { address, password } });
          break;
        } catch (error) {
          lastError = error;
          if (error.status !== 409 && error.status !== 422) throw error;
        }
      }
      if (!account) throw lastError || new Error("Could not create an inbox. Try again.");

      const auth = await api("/token", { method: "POST", body: { address, password } });
      inbox = { id: account.id, address, password, token: auth.token };
      saveInbox(); messages = []; selectedId = null; render();
      setStatus("Inbox ready. Checking for messages…");
      await refresh();

      if (oldInbox?.id && oldInbox.id !== inbox.id) {
        api(`/accounts/${encodeURIComponent(oldInbox.id)}`, { method: "DELETE", token: oldInbox.token }).catch(() => {});
      }
    } catch (error) {
      inbox = oldInbox || null; saveInbox(); render();
      setStatus(error.message || "Could not create an inbox.", true);
    } finally {
      els.newBtn.disabled = false;
    }
  }

  async function refresh() {
    if (!inbox || syncing) return;
    syncing = true; els.refreshBtn.disabled = true; setStatus("Checking for messages…");
    try {
      messages = list(await api("/messages?page=1", { token: inbox.token }));
      renderMessages();
      setStatus(messages.length ? "Inbox updated." : "Waiting for messages…");
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        inbox = null; saveInbox(); await createInbox();
      } else setStatus(error.message || "Could not check messages.", true);
    } finally {
      syncing = false; els.refreshBtn.disabled = !inbox;
    }
  }

  function render() {
    els.address.textContent = inbox?.address || "No inbox";
    els.copyBtn.disabled = !inbox; els.refreshBtn.disabled = !inbox;
    renderMessages(); clearReader();
  }

  function sender(message) {
    return message.from?.name || message.from?.address || "Unknown";
  }

  function date(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function renderMessages() {
    els.messageList.replaceChildren();
    els.count.textContent = messages.length ? String(messages.length) : "";
    if (!messages.length) {
      const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No messages";
      els.messageList.appendChild(empty); return;
    }
    for (const message of messages) {
      const button = document.createElement("button"); button.type = "button"; button.className = "message";
      if (message.id === selectedId) button.classList.add("active");
      const top = document.createElement("div"); top.className = "message-top";
      const from = document.createElement("span"); from.className = "message-from"; from.textContent = sender(message);
      const when = document.createElement("span"); when.className = "message-date"; when.textContent = date(message.createdAt);
      const subject = document.createElement("span"); subject.className = "message-subject"; subject.textContent = message.subject || "(no subject)";
      const preview = document.createElement("span"); preview.className = "message-preview"; preview.textContent = message.intro || "";
      top.append(from, when); button.append(top, subject, preview); button.addEventListener("click", () => openMessage(message.id));
      els.messageList.appendChild(button);
    }
  }

  function clearReader() {
    selectedId = null; els.readerEmpty.classList.remove("hidden"); els.readerContent.classList.add("hidden");
    els.emailFrame.removeAttribute("srcdoc");
  }

  function safeHtml(source) {
    const doc = new DOMParser().parseFromString(source, "text/html");
    doc.querySelectorAll("script,iframe,frame,object,embed,form,input,button,textarea,select,meta,base").forEach(node => node.remove());
    doc.querySelectorAll("*").forEach(node => {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase(), value = attr.value.trim();
        if (name.startsWith("on")) node.removeAttribute(attr.name);
        if ((name === "href" || name === "src") && !/^(https?:|mailto:|data:image\/)/i.test(value)) node.removeAttribute(attr.name);
        if (name === "style" && /url\s*\(/i.test(value)) node.removeAttribute("style");
      }
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    doc.querySelectorAll("style").forEach(style => {
      style.textContent = style.textContent.replace(/@import[^;]+;?/gi, "").replace(/url\s*\([^)]*\)/gi, "none");
    });
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline';"><style>body{margin:20px;color:#17202a;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;overflow-wrap:anywhere}a{color:#2563eb}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style></head><body>${doc.body.innerHTML}</body></html>`;
  }

  async function openMessage(id) {
    if (!inbox) return;
    setStatus("Opening message…");
    try {
      const message = await api(`/messages/${encodeURIComponent(id)}`, { token: inbox.token });
      selectedId = id; renderMessages();
      els.subject.textContent = message.subject || "(no subject)";
      const to = (message.to || []).map(item => item.address).filter(Boolean).join(", ");
      els.meta.textContent = `From: ${sender(message)}${message.from?.address && message.from.address !== sender(message) ? ` <${message.from.address}>` : ""}\nTo: ${to || inbox.address}`;
      renderAttachments(message);
      const html = Array.isArray(message.html) ? message.html[0] : message.html;
      const body = html || `<pre>${escapeText(message.text || message.intro || "No message body")}</pre>`;
      els.emailFrame.srcdoc = safeHtml(body);
      els.readerEmpty.classList.add("hidden"); els.readerContent.classList.remove("hidden");
      setStatus("Message opened.");
    } catch (error) { setStatus(error.message || "Could not open message.", true); }
  }

  function escapeText(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function renderAttachments(message) {
    els.attachments.replaceChildren();
    const items = Array.isArray(message.attachments) ? message.attachments : [];
    for (const attachment of items) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = attachment.filename || "Attachment";
      button.addEventListener("click", () => downloadAttachment(message.id, attachment)); els.attachments.appendChild(button);
    }
    els.attachments.classList.toggle("hidden", !items.length);
  }

  async function downloadAttachment(messageId, attachment) {
    if (!inbox) return;
    try {
      const path = attachment.downloadUrl || `/messages/${encodeURIComponent(messageId)}/attachment/${encodeURIComponent(attachment.id)}`;
      const response = await api(path.startsWith(API) ? path.slice(API.length) : path, { token: inbox.token, raw: true });
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = attachment.filename || "attachment"; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setStatus(error.message || "Could not download attachment.", true); }
  }

  els.copyBtn.addEventListener("click", async () => {
    if (!inbox) return;
    try { await navigator.clipboard.writeText(inbox.address); setStatus("Address copied."); }
    catch (_) { setStatus(`Copy this address: ${inbox.address}`); }
  });
  els.refreshBtn.addEventListener("click", refresh);
  els.newBtn.addEventListener("click", createInbox);

  async function init() {
    loadInbox(); render();
    if (inbox) await refresh(); else await createInbox();
    setInterval(refresh, POLL_MS);
  }

  init().catch(error => setStatus(error.message || "Could not start tempMail.", true));
})();
