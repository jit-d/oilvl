
const CHECK_INTERVAL = 3000;
const STORAGE_KEY = "nuvama_nifty_baseline";

function numberValue(value) {
  const cleaned = String(value || "")
    .replace(/,/g, "")
    .replace(/[^\d.+-]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cellLines(cell) {
  return (cell?.innerText || "")
    .split(/\n/)
    .map(x => x.trim())
    .filter(Boolean);
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

function getRows(table) {
  return [...table.querySelectorAll("tbody tr")];
}

function extractSnapshot() {
  const tables = [...document.querySelectorAll("table")];

  const ce = tables.find(t =>
    t.classList.contains("calls-table-ltr")
  );

  const strikeTable = tables.find(t =>
    t.classList.contains("table-layout-sticky") &&
    !t.classList.contains("calls-table-ltr")
  );

  const pe = tables.find(t =>
    t.classList.contains("table-layout-sticky") &&
    !t.classList.contains("calls-table-ltr") &&
    t !== strikeTable
  );

  // Use table order as a fallback for the two non-CE tables.
  const middle = tables.filter(t =>
    t.classList.contains("table-layout-sticky") &&
    !t.classList.contains("calls-table-ltr")
  );

  const strike = middle[0];
  const put = middle[1];

  if (!ce || !strike || !put) {
    throw new Error("Option-chain tables not found");
  }

  const ceRows = getRows(ce);
  const strikeRows = getRows(strike);
  const peRows = getRows(put);

  if (
    !ceRows.length ||
    ceRows.length !== strikeRows.length ||
    peRows.length !== strikeRows.length
  ) {
    throw new Error(
      `Row mismatch: CE ${ceRows.length}, Strike ${strikeRows.length}, PE ${peRows.length}`
    );
  }

  const contracts = [];

  for (let i = 0; i < strikeRows.length; i++) {
    const strikeCells = strikeRows[i].querySelectorAll("td");
    const ceCells = ceRows[i].querySelectorAll("td");
    const peCells = peRows[i].querySelectorAll("td");

    if (!strikeCells.length || ceCells.length < 8 || peCells.length < 8) {
      continue;
    }

    const strikePrice = numberValue(strikeCells[0].innerText);

    if (strikePrice === null) continue;

    const ceOI = cellLines(ceCells[6]);
    const peOI = cellLines(peCells[1]);

    contracts.push({
      strike: strikePrice,
      ce: {
        volume: numberValue(ceCells[5].innerText),
        oi: numberValue(ceOI[0]),
        changeOI: numberValue(ceOI[1])
      },
      pe: {
        volume: numberValue(peCells[2].innerText),
        oi: numberValue(peOI[0]),
        changeOI: numberValue(peOI[1])
      }
    });
  }

  if (!contracts.length) {
    throw new Error("No valid option contracts extracted");
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
    ["Volume", "volume"],
    ["Change in OI", "changeOI"],
    ["OI", "oi"]
  ];

  for (const side of ["ce", "pe"]) {
    for (const [label, field] of metrics) {
      const category = `${side.toUpperCase()} ${label}`;

      const ranked = snapshot.contracts
        .filter(c => c[side][field] !== null)
        .sort((a, b) => b[side][field] - a[side][field])
        .slice(0, 2)
        .map((c, index) => ({
          rank: index + 1,
          strike: c.strike,
          value: c[side][field]
        }));

      rankings[category] = ranked;
    }
  }

  return rankings;
}

function rankingsChanged(oldRankings, newRankings) {
  if (!oldRankings) return true;

  return Object.keys(newRankings).some(category => {
    const oldList = oldRankings[category] || [];
    const newList = newRankings[category] || [];

    return [0, 1].some(i =>
      oldList[i]?.strike !== newList[i]?.strike
    );
  });
}

async function sendEvent(payload) {
  chrome.runtime.sendMessage({
    type: "SAVE_EVENT",
    payload
  });
}

async function check() {
  try {
    const snapshot = extractSnapshot();
    const rankings = makeRankings(snapshot);

    const key = `${snapshot.instrument}_${snapshot.expiry}`;
    const stored = await chrome.storage.local.get(STORAGE_KEY);

    const all = stored[STORAGE_KEY] || {};
    const previous = all[key];

    if (!previous) {
      await sendEvent({
        eventType: "INITIAL",
        snapshot,
        rankings
      });

      all[key] = { rankings };
      await chrome.storage.local.set({
        [STORAGE_KEY]: all
      });

      console.log("[Nuvama] Initial baseline saved", rankings);
      return;
    }

    if (rankingsChanged(previous.rankings, rankings)) {
      await sendEvent({
        eventType: "RANKING_CHANGE",
        snapshot,
        oldRankings: previous.rankings,
        rankings
      });

      all[key] = { rankings };

      await chrome.storage.local.set({
        [STORAGE_KEY]: all
      });

      console.log("[Nuvama] Ranking change detected", rankings);
    }

  } catch (error) {
    console.warn("[Nuvama Tracker]", error.message);
  }
}

check();
setInterval(check, CHECK_INTERVAL);

