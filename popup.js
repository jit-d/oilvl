
const fields = ["owner", "repo", "branch", "token"];
const status = document.getElementById("status");

chrome.storage.local.get(["settings"], result => {
  const settings = result.settings || {};

  fields.forEach(key => {
    document.getElementById(key).value =
      settings[key] || (key === "branch" ? "main" : "");
  });
});

function getSettings() {
  return Object.fromEntries(
    fields.map(key => [
      key,
      document.getElementById(key).value.trim()
    ])
  );
}

document.getElementById("save").addEventListener("click", async () => {
  const settings = getSettings();

  await chrome.storage.local.set({ settings });

  status.textContent = "Settings saved.";
});

const testButton = document.createElement("button");
testButton.textContent = "Test GitHub Connection";
testButton.style.marginTop = "10px";

document.body.insertBefore(testButton, status);

testButton.addEventListener("click", async () => {
  const s = getSettings();

  if (!s.owner || !s.repo || !s.branch || !s.token) {
    status.textContent = "Please fill in all fields.";
    return;
  }

  status.textContent = "Checking connection...";

  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`,
      {
        headers: {
          Authorization: `Bearer ${s.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    if (!response.ok) {
  const details = await response.text();

  throw new Error(
    `HTTP ${response.status}: ${details}`
  );
}

    const repo = await response.json();

    const branchResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/branches/${encodeURIComponent(s.branch)}`,
      {
        headers: {
          Authorization: `Bearer ${s.token}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    if (!branchResponse.ok) {
      throw new Error("Branch not found or inaccessible.");
    }

    status.textContent =
      "✓ Connected! Private repository and branch verified.";
    status.style.color = "green";

  } catch (error) {
    status.textContent = "✗ " + error.message;
    status.style.color = "red";
  }
});
