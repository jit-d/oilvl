const CHECK_INTERVAL = 3000;

const SESSION_KEY = "nuvama_active_session";

let previousRankings = null;
let initialized = false;

const sessionId = crypto.randomUUID();

function numberValue(value) {
  const cleaned = String(value || "")
    .replace(/,/g, "")
    .replace(/[^\d.+-]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cellLines(cell) {
  return (cell?.innerText || "")
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);
}

function getRows(table) {
  return [...table.querySelectorAll("tbody tr")];
}

function getExpiry() {
  const selects = [...document.querySelectorAll("select")];

  for (const select of selects) {
    const value =
      select.options[select.selectedIndex]?.text?.trim();

    if (value && /20\d{2}|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i.test(value)) {
      return value;
    }
  }

  return "Expiry not detected";
}

function extractSnapshot() {
  const tables = [
    ...document.querySelectorAll("table.table-layout-sticky")
  ];

  const ce = tables.find(t =>
    t.classList.contains("calls-table-ltr")
  );

  const others = tables.filter(t => t !== ce);

  const strike = others[0];
  const pe = others[1];

  if (!ce || !strike || !pe) {
    throw new Error("CE, strike or PE table not found");
  }

  const ceRows = getRows(ce);
  const strikeRows = getRows(strike);
  const peRows = getRows(pe);

  if (
    !ceRows.length ||
    ceRows.length !== strikeRows.length ||
    peRows.length !== strikeRows.length
  ) {
    throw new Error("Option-chain row mismatch");
  }

  const contracts = [];

  for (let i = 0; i < strikeRows.length; i++) {
    const sc = strikeRows[i].querySelectorAll("td");
    const cc = ceRows[i].querySelectorAll("td");
    const pc = peRows[i].querySelectorAll("td");

    if (!sc.length || cc.length < 8 || pc.length < 8) continue;

    const strikePrice = numberValue(sc[0].innerText);

    if (strikePrice === null) continue;

    const ceOI = cellLines(cc[6]);
    const peOI = cellLines(pc[1]);

    contracts.push({
      strike: strikePrice,

      ce: {
        volume: numberValue(cc[5].innerText),
        oi: numberValue(ceOI[0]),
        changeOI: numberValue(ceOI[1])
      },

      pe: {
        volume: numberValue(pc[2].innerText),
        oi: numberValue(peOI[0]),
        changeOI: numberValue(peOI[1])
      }
    });
  }

  if (!contracts.length) {
    throw new Error("No valid contracts extracted");
  }

  return {
    instrument: "NIFTY",
    expiry: getExpiry(),
    detectedAt: new Date().toISOString(),
    contracts
  };
}

function makeRankings(snapshot) {
  const rankings = {};

  const metrics = [
    ["OI", "oi"],
    ["ChOI", "changeOI"],
    ["Volume", "volume"]
  ];

  for (const side of ["ce", "pe"]) {
    for (const [label, field] of metrics) {
      const category = `${side.toUpperCase()} ${label}`;

      rankings[category] = snapshot.contracts
        .filter(c => c[side][field] !== null)
        .sort((a, b) => b[side][field] - a[side][field])
        .slice(0, 2)
        .map((c, index) => ({
          rank: index + 1,
          strike: c.strike,
          value: c[side][field]
        }));
    }
  }

  return rankings;
}

function computeChanges(oldRankings, newRankings) {
  const changes = [];

  for (const category of Object.keys(newRankings)) {
    const oldList = oldRankings[category] || [];
    const newList = newRankings[category] || [];

    for (let i = 0; i < 2; i++) {
      const oldEntry = oldList[i];
      const newEntry = newList[i];

      if (oldEntry?.strike !== newEntry?.strike) {
        changes.push({
          category,
          rank: i + 1,
          fromStrike: oldEntry?.strike ?? null,
          toStrike: newEntry?.strike ?? null,
          fromValue: oldEntry?.value ?? null,
          toValue: newEntry?.value ?? null
        });
      }
    }
  }

  return changes;
}

function sendEvent(payload) {
  chrome.runtime.sendMessage({
    type: "SAVE_EVENT",
    payload
  }, response => {
    if (chrome.runtime.lastError) {
      console.error(
        "[Nuvama] Event queue error:",
        chrome.runtime.lastError.message
      );
      return;
    }

    if (!response?.success) {
      console.error("[Nuvama] Event was not queued", response);
    }
  });
}

async function check() {
  try {
    const snapshot = extractSnapshot();
    const rankings = makeRankings(snapshot);

    // First successful extraction in this page session.
    if (!initialized) {
      initialized = true;
      previousRankings = rankings;

      await chrome.storage.local.set({
        [SESSION_KEY]: {
          sessionId,
          startedAt: snapshot.detectedAt,
          expiry: snapshot.expiry,
          rankings
        }
      });

      sendEvent({
        eventId: crypto.randomUUID(),
        sessionId,
        eventType: "OPEN",
        detectedAt: snapshot.detectedAt,
        expiry: snapshot.expiry,
        sets: rankings
      });

      console.log(
        "[Nuvama] Page opened, saved 6 data sets:",
        rankings
      );

      return;
    }

    const changes = computeChanges(previousRankings, rankings);

    if (changes.length) {
      previousRankings = rankings;

      await chrome.storage.local.set({
        [SESSION_KEY]: {
          sessionId,
          updatedAt: snapshot.detectedAt,
          expiry: snapshot.expiry,
          rankings
        }
      });

      sendEvent({
        eventId: crypto.randomUUID(),
        sessionId,
        eventType: "CHANGE",
        detectedAt: snapshot.detectedAt,
        changes
      });

      console.log("[Nuvama] Changes:", changes);
    }

  } catch (error) {
    console.warn("[Nuvama Tracker]", error.message);
  }
}

check();
setInterval(check, CHECK_INTERVAL);