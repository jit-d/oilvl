
const SCRIPT_URL = "YOUR_GOOGLE_APPS_SCRIPT_URL";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "SAVE_EVENT") return;

  chrome.storage.local.get(["settings"], async result => {
    const settings = result.settings || {};

    if (!settings.scriptUrl) {
      console.warn("Google Sheets URL not configured.");
      return;
    }

    try {
      const response = await fetch(settings.scriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          token: settings.token,
          ...message.payload
        })
      });

      const result = await response.json();
      console.log("[Nuvama Sheets]", result);

    } catch (error) {
      console.error("[Nuvama Sheets] Upload failed:", error);
    }
  });

  sendResponse({ received: true });
  return true;
});
