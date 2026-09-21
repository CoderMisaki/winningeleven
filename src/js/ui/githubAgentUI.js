// src/js/ui/githubAgentUI.js

import { GitHubAgentEngine } from "../services/githubAgent.js";
import { Security } from "../utils/security.js";
import { BrowserAgentOrchestrator } from "../services/agentOrchestrator.js";
import { AgentPersistence } from "../services/agentPersistence.js";

let activeEngine = null;
let activeOrchestrator = null;

export const GitHubAgentUI = {
  init() {
    const tokenInput = document.getElementById("ghTokenInput");
    const btnConnect = document.getElementById("btnConnectGH");
    const repoSelect = document.getElementById("ghRepoSelect");
    const btnRunTask = document.getElementById("btnRunAgentTask");
    const promptInput = document.getElementById("agentPromptInput");
    const statusBox = document.getElementById("agentStatusOutput");

    const savedToken = localStorage.getItem("we10_gh_pat");
    if (savedToken && tokenInput) tokenInput.value = savedToken;

    btnConnect?.addEventListener("click", async () => {
      const token = tokenInput.value.trim();
      if (!token) return alert("Masukkan GitHub Personal Access Token!");
      localStorage.setItem("we10_gh_pat", token);

      activeEngine = new GitHubAgentEngine(token);
      statusBox.textContent = "Mengambil daftar repositori...";
      try {
        const repos = await activeEngine.listUserRepos();
        repoSelect.innerHTML = (Array.isArray(repos) ? repos : [])
          .filter(r => r && r.full_name)
          .map(r => `<option value="${Security.escapeHtml(r.full_name)}">${Security.escapeHtml(r.full_name)}</option>`)
          .join("");
        repoSelect.disabled = false;
        btnRunTask.disabled = false;
        statusBox.textContent = `Terhubung ke GitHub. Siap menjalankan task.`;

        await this.checkPendingCheckpoints(repoSelect.value);
      } catch (err) {
        statusBox.textContent = `Error: ${err?.message || String(err)}`;
      }
    });

    repoSelect?.addEventListener("change", async () => {
      await this.checkPendingCheckpoints(repoSelect.value);
    });

    btnRunTask?.addEventListener("click", async () => {
      const promptText = promptInput.value.trim();
      const repoFullName = repoSelect.value;
      if (!promptText || !repoFullName) return;

      const [owner, repo] = repoFullName.split("/");
      activeOrchestrator = new BrowserAgentOrchestrator(activeEngine, owner, repo, "main");

      btnRunTask.disabled = true;
      this.initLiveDisplay(statusBox);

      try {
        await activeOrchestrator.initialize();
        const pr = await activeOrchestrator.runTask(
          promptText,
          (status) => this.updateStatus(status),
          (reasoningChunk) => this.appendReasoning(reasoningChunk),
          (contentChunk) => this.appendContent(contentChunk)
        );

        statusBox.innerHTML = `✅ <strong>Selesai!</strong> Pull Request: <a href="${Security.escapeHtml(pr.html_url || "#")}" target="_blank" rel="noopener noreferrer" style="color: #00ff66;">${Security.escapeHtml(pr.html_url || "")}</a>`;
      } catch (err) {
        statusBox.innerHTML = `❌ <strong>Gagal:</strong> ${Security.escapeHtml(err?.message || String(err))}`;
        await this.checkPendingCheckpoints(repoFullName);
      } finally {
        btnRunTask.disabled = false;
      }
    });
  },

  initLiveDisplay(statusBox) {
    statusBox.innerHTML = `
      <div id="agentStatusTitle" style="color: #00ffff; margin-bottom: 6px;">Memulai proses...</div>
      <details open style="margin-bottom: 8px; border: 1px solid #333; padding: 6px; background: #000;">
        <summary style="cursor: pointer; color: #ffaa00; font-weight: bold;">🧠 AI Reasoning Process</summary>
        <pre id="agentReasoningStream" style="white-space: pre-wrap; font-size: 0.7rem; color: #888; max-height: 200px; overflow-y: auto; margin-top: 4px;"></pre>
      </details>
      <details open style="border: 1px solid #333; padding: 6px; background: #000;">
        <summary style="cursor: pointer; color: #00ff66; font-weight: bold;">💻 Code & PR Generation</summary>
        <pre id="agentContentStream" style="white-space: pre-wrap; font-size: 0.7rem; color: #ccc; max-height: 200px; overflow-y: auto; margin-top: 4px;"></pre>
      </details>
    `;
  },

  updateStatus(msg) {
    const titleEl = document.getElementById("agentStatusTitle");
    if (titleEl) titleEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  },

  appendReasoning(chunk) {
    const reasoningEl = document.getElementById("agentReasoningStream");
    if (reasoningEl) {
      reasoningEl.textContent += chunk;
      reasoningEl.scrollTop = reasoningEl.scrollHeight;
    }
  },

  appendContent(chunk) {
    const contentEl = document.getElementById("agentContentStream");
    if (contentEl) {
      contentEl.textContent += chunk;
      contentEl.scrollTop = contentEl.scrollHeight;
    }
  },

  async checkPendingCheckpoints(repoFullName) {
    const banner = document.getElementById("resumeBanner");
    const statusBox = document.getElementById("agentStatusOutput");
    const active = await AgentPersistence.getActiveCheckpoint(repoFullName);

    if (active && banner) {
      banner.style.display = "block";
      banner.innerHTML = `
        <div class="resume-banner">
          <strong>Task Terhenti Ditemukan:</strong> "${Security.escapeHtml(String(active.userPrompt || "(tanpa judul)").slice(0, 70))}..."
          <div style="margin-top: 8px; display: flex; gap: 8px;">
            <button id="btnResumeTask" class="btn btn-primary" style="padding: 5px 10px; font-size: 0.65rem;">▶ RESUME TASK OTOMATIS</button>
            <button id="btnDiscardTask" class="btn" style="padding: 5px 10px; font-size: 0.65rem; color: #ff5555;">Hapus Task</button>
          </div>
        </div>
      `;

      document.getElementById("btnResumeTask")?.addEventListener("click", async () => {
        banner.style.display = "none";
        const [owner, repo] = repoFullName.split("/");
        activeOrchestrator = new BrowserAgentOrchestrator(activeEngine, owner, repo, active.branch);
        await activeOrchestrator.initialize();
        this.initLiveDisplay(statusBox);

        try {
          const pr = await activeOrchestrator.resumeTask(
            active,
            (msg) => this.updateStatus(msg),
            (rChunk) => this.appendReasoning(rChunk),
            (cChunk) => this.appendContent(cChunk)
          );
          statusBox.innerHTML = `✅ <strong>Selesai:</strong> PR berhasil dibuat: <a href="${Security.escapeHtml(pr.html_url || "#")}" target="_blank" rel="noopener noreferrer" style="color: #00ff66;">${Security.escapeHtml(pr.html_url || "")}</a>`;
        } catch (e) {
          statusBox.innerHTML = `❌ Gagal saat resume: ${Security.escapeHtml(e?.message || String(e))}`;
          await this.checkPendingCheckpoints(repoFullName);
        }
      });

      document.getElementById("btnDiscardTask")?.addEventListener("click", async () => {
        await AgentPersistence.clearTaskCheckpoint(active.taskId);
        banner.style.display = "none";
        statusBox.textContent = "Task checkpoint dibersihkan.";
      });
    } else if (banner) {
      banner.style.display = "none";
    }
  }
};
