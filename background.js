
const API = "https://api.github.com";

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

async function githubRequest(path, options, token) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

async function getFile(owner, repo, branch, path, token) {
  try {
    return await githubRequest(
      `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      { method: "GET" },
      token
    );
  } catch (error) {
    if (error.message.includes("GitHub API 404")) return null;
    throw error;
  }
}

async function putFile(owner, repo, branch, path, content, token, message) {
  const existing = await getFile(
    owner, repo, branch, path, token
  );

  const body = {
    message,
    content: encodeBase64(content),
    branch
  };

  if (existing?.sha) body.sha = existing.sha;

  return githubRequest(
    `/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    token
  );
}

async function saveToGitHub(data, settings) {
  const { owner, repo, branch, token } = settings;

  if (!owner || !repo || !branch || !token) {
    throw new Error("Complete GitHub settings first.");
  }

  const date = new Date(data.snapshot.detectedAt)
    .toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata"
    });

  const historyPath = `history/${date}.json`;
  const currentPath = "current.json";

  // Read existing daily history
  const existing = await getFile(
    owner, repo, branch, historyPath, token
  );

  let history = [];

  if (existing?.content) {
    const decoded = atob(existing.content.replace(/\n/g, ""));
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    history = JSON.parse(new TextDecoder().decode(bytes));
  }

  history.push(data);

  // Append historical event
  await putFile(
    owner, repo, branch, historyPath,
    JSON.stringify(history, null, 2),
    token,
    `Record NIFTY ranking event ${date}`
  );

  // Update current rankings
  await putFile(
    owner, repo, branch, currentPath,
    JSON.stringify({
      instrument: "NIFTY",
      expiry: data.snapshot.expiry,
      updatedAt: data.snapshot.detectedAt,
      rankings: data.rankings
    }, null, 2),
    token,
    "Update current NIFTY rankings"
  );

  return { success: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "SAVE_EVENT") return;

  chrome.storage.local.get(["settings"], async result => {
    try {
      await saveToGitHub(
        message.payload,
        result.settings || {}
      );

      sendResponse({ success: true });
    } catch (error) {
      console.error("[GitHub upload]", error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  });

  return true;
});
