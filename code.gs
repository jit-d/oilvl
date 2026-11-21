
const SECRET_TOKEN = "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.token !== SECRET_TOKEN) {
      throw new Error("Unauthorized");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    let history = ss.getSheetByName("Change History");
    if (!history) {
      history = ss.insertSheet("Change History");
      history.appendRow([
        "Detected At (IST)",
        "Event",
        "Expiry",
        "Category",
        "Old Rank 1",
        "New Rank 1",
        "Old Rank 2",
        "New Rank 2",
        "New Rank 1 Value",
        "New Rank 2 Value"
      ]);
    }

    let current = ss.getSheetByName("Current State");
    if (!current) {
      current = ss.insertSheet("Current State");
    }

    const timestamp = Utilities.formatDate(
      new Date(data.snapshot.detectedAt),
      "Asia/Kolkata",
      "yyyy-MM-dd HH:mm:ss"
    );

    const old = data.oldRankings || {};
    const next = data.rankings || {};

    const rows = [];

    Object.keys(next).forEach(category => {
      const before = old[category] || [];
      const after = next[category] || [];

      const changed = [0, 1].some(i =>
        before[i]?.strike !== after[i]?.strike
      );

      if (data.eventType === "INITIAL" || changed) {
        rows.push([
          timestamp,
          data.eventType,
          data.snapshot.expiry,
          category,
          before[0]?.strike ?? "",
          after[0]?.strike ?? "",
          before[1]?.strike ?? "",
          after[1]?.strike ?? "",
          after[0]?.value ?? "",
          after[1]?.value ?? ""
        ]);
      }
    });

    if (rows.length) {
      history.getRange(
        history.getLastRow() + 1,
        1,
        rows.length,
        rows[0].length
      ).setValues(rows);
    }

    current.clearContents();

    current.getRange(1, 1, 1, 6).setValues([[
      "Detected At (IST)",
      "Expiry",
      "Category",
      "Rank",
      "Strike",
      "Value"
    ]]);

    const currentRows = [];

    Object.keys(next).forEach(category => {
      next[category].forEach(item => {
        currentRows.push([
          timestamp,
          data.snapshot.expiry,
          category,
          item.rank,
          item.strike,
          item.value
        ]);
      });
    });

    if (currentRows.length) {
      current.getRange(
        2, 1,
        currentRows.length,
        6
      ).setValues(currentRows);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        event: data.eventType,
        records: rows.length
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
