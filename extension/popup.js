const $ = (id) => document.getElementById(id);

$("breakNow").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "break-now" });
  window.close();
});

$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
