
const fields = ["owner", "repo", "branch", "token"];

chrome.storage.local.get(["settings"], result => {
  const settings = result.settings || {};

  fields.forEach(key => {
    document.getElementById(key).value =
      settings[key] || (key === "branch" ? "main" : "");
  });
});

document.getElementById("save").addEventListener("click", async () => {
  const settings = {};

  fields.forEach(key => {
    settings[key] =
      document.getElementById(key).value.trim();
  });

  await chrome.storage.local.set({ settings });

  document.getElementById("status").textContent =
    "GitHub settings saved.";
});
