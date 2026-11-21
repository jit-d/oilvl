const API = "https://api.github.com";
const QUEUE_KEY = "nuvama_pending_events";

let processing = false;

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";

  bytes.forEach(b => {
    binary += String.fromCharCode(b);
  });

  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(
    binary,
    c => c.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}

function istDate(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(iso));

  const get = type =>
    parts.find(p => p.type === type).value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function request(path, options, token) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub ${response.status}: ${error}`);
  }

  return response.json();
}

async function getFile(path, settings) {
  try {
    return await request(
      `/repos/${settings.owner}/${settings.repo}/contents/${path}?ref=${encodeURIComponent(settings.branch)}`,
      { method: "GET" },
      settings.token
    );
  } catch (error) {
    if (error.message.includes("GitHub 404")) {
      return null;
    }

    throw error;
  }
}

async function putFile(path, content, settings, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await getFile(path, settings);

    const body = {
      message,
      content: encodeBase64(content),
      branch: settings.branch
    };

    if (existing?.sha) {
      body.sha = existing.sha;
    }

    try {
      return await request(
        `/repos/${settings.owner}/${settings.repo}/contents/${path}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        },
        settings.token
      );
    } catch (error) {
      if (
        !error.message.includes("GitHub 409") &&
        !error.message.includes("GitHub 422")
      ) {
        throw error;
      }
    }
  }

  throw new Error("GitHub file update conflict. Will retry later.");
}

function formatChange(change) {
  const from = change.fromStrike === null
    ? "empty"
    : change.fromStrike;

  return `${change.category} #${change.rank} changed from ${from} to ${change.toStrike}`;
}

function makeLogEntry(event) {
  if (event.eventType === "OPEN") {
    return {
      type: "OPEN",
      at: event.detectedAt,
      expiry: event.expiry,
      sets: event.sets
    };
  }

  return {
    type: "CHANGE",
    at: event.detectedAt,
    changes: event.changes.map(formatChange)
  };
}

async function uploadEvent(event, settings) {
  const date = istDate(event.detectedAt);
  const historyPath = `history/${date}.json`;

  // Read daily log.
  const file = await getFile(historyPath, settings);

  let log = [];

  if (file?.content) {
    log = JSON.parse(decodeBase64(file.content));
  }

  // Prevent duplicate event IDs after an uncertain upload.
  if (!log.some(item => item.eventId === event.eventId)) {
    log.push({
      eventId: event.eventId,
      sessionId: event.sessionId,
      ...makeLogEntry(event)
    });

    await putFile(
      historyPath,
      JSON.stringify(log, null, 2),
      settings,
      `Log NIFTY ${event.eventType}`
    );
  }
}

async function processQueue() {
  if (processing) return;

  processing = true;

  try {
    while (true) {
      const stored = await chrome.storage.local.get([
        QUEUE_KEY,
        "settings"
      ]);

      const queue = stored[QUEUE_KEY] || [];
      const settings = stored.settings || {};

      if (!queue.length) break;

      if (
        !settings.owner ||
        !settings.repo ||
        !settings.branch ||
        !settings.token
      ) {
        console.warn("[Nuvama] GitHub settings missing.");
        break;
      }

      const event = queue[0];

      try {
        await uploadEvent(event, settings);

        // Remove only after successful upload.
        const latest = await chrome.storage.local.get(QUEUE_KEY);
        const remaining = (latest[QUEUE_KEY] || [])
          .filter(item => item.eventId !== event.eventId);

        await chrome.storage.local.set({
          [QUEUE_KEY]: remaining
        });

        console.log(
          "[Nuvama] Uploaded:",
          event.eventType,
          event.eventId
        );

      } catch (error) {
        console.error("[Nuvama] Upload failed; queued:", error);
        break;
      }
    }

  } finally {
    processing = false;
  }
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message.type !== "SAVE_EVENT") return;

    (async () => {
      const stored = await chrome.storage.local.get(QUEUE_KEY);
      const queue = stored[QUEUE_KEY] || [];

      if (!queue.some(e => e.eventId === message.payload.eventId)) {
        queue.push(message.payload);

        await chrome.storage.local.set({
          [QUEUE_KEY]: queue
        });
      }

      sendResponse({ success: true, queued: true });

      processQueue();
    })().catch(error => {
      console.error(error);
      sendResponse({
        success: false,
        error: error.message
      });
    });

    return true;
  }
);

// Retry pending uploads periodically.
chrome.alarms.create("nuvama-upload-retry", {
  periodInMinutes: 1
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "nuvama-upload-retry") {
    processQueue();
  }
});

chrome.runtime.onStartup.addListener(processQueue);
chrome.runtime.onInstalled.addListener(processQueue);