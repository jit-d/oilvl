
const url = document.getElementById("url");
const token = document.getElementById("token");
const status = document.getElementById("status");

chrome.storage.local.get(["settings"], result => {
  const settings = result.settings || {};
  url.value = settings.scriptUrl || "";
  token.value = settings.token || "";
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    settings: {
      scriptUrl: url.value.trim(),
      token: token.value.trim()
    }
  });

  status.textContent = "Settings saved!";
});
