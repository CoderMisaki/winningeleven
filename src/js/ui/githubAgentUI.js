// src/js/ui/githubAgentUI.js

import { GitHubAgentEngine } from "../services/githubAgent.js";
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
        repoSelect.innerHTML = repos.map(r => `<option value="${r.full_name}">${r.full_name}</option>`).join("");
        repoSelect.disabled = false;
        btnRunTask.disabled = false;
        statusBox.textContent = `Terhubung sebagai user GitHub. ${repos.length} repositori dimuat.`;

        await this.checkPendingCheckpoints(repoSelect.value);
      } catch (err) {
        statusBox.textContent = `Error: ${err.message}`;
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
      try {
        await activeOrchestrator.initialize();
        const pr = await activeOrchestrator.runTask(promptText, (msg) => {
          statusBox.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        });
        statusBox.innerHTML = `✅ <strong>Selesai!</strong> Pull Request dibuat: <a href="${pr.html_url}" target="_blank" style="color: #0ff;">${pr.html_url}</a>`;
      } catch (err) {
        statusBox.textContent = `❌ Terhenti: ${err.message}. Checkpoint tersimpan di browser.`;
      } finally {
        btnRunTask.disabled = false;
      }
    });

    window.addEventListener("online", async () => {
      if (activeOrchestrator && repoSelect.value) {
        statusBox.textContent = "Jaringan kembali online. Memeriksa checkpoint untuk melanjutkan...";
        await this.checkPendingCheckpoints(repoSelect.value);
      }
    });
  },

  async checkPendingCheckpoints(repoFullName) {
    const banner = document.getElementById("resumeBanner");
    const statusBox = document.getElementById("agentStatusOutput");
    const active = await AgentPersistence.getActiveCheckpoint(repoFullName);

    if (active && banner) {
      banner.style.display = "block";
      banner.innerHTML = `
        <div style="background: #332200; border: 1px solid #ffaa00; padding: 10px; margin-bottom: 10px; font-size: 0.75rem;">
          <strong>Ditemukan Task Belum Selesai:</strong> "${active.userPrompt.slice(0, 60)}..."
          <div style="margin-top: 5px; display: flex; gap: 8px;">
            <button id="btnResumeTask" class="btn btn-primary" style="padding: 4px 8px; font-size: 0.65rem;">Lanjutkan (Resume)</button>
            <button id="btnDiscardTask" class="btn" style="padding: 4px 8px; font-size: 0.65rem; color: #f55;">Hapus Task</button>
          </div>
        </div>
      `;

      document.getElementById("btnResumeTask")?.addEventListener("click", async () => {
        banner.style.display = "none";
        const [owner, repo] = repoFullName.split("/");
        activeOrchestrator = new BrowserAgentOrchestrator(activeEngine, owner, repo, active.branch);
        await activeOrchestrator.initialize();
        try {
          const pr = await activeOrchestrator.resumeTask(active, (msg) => {
            statusBox.textContent = `[RESUME] ${msg}`;
          });
          statusBox.innerHTML = `✅ <strong>Selesai!</strong> PR: <a href="${pr.html_url}" target="_blank" style="color:#0ff;">${pr.html_url}</a>`;
        } catch (e) {
          statusBox.textContent = `Gagal melanjutkan: ${e.message}`;
        }
      });

      document.getElementById("btnDiscardTask")?.addEventListener("click", async () => {
        await AgentPersistence.clearTaskCheckpoint(active.taskId);
        banner.style.display = "none";
        statusBox.textContent = "Checkpoint dibatalkan.";
      });
    } else if (banner) {
      banner.style.display = "none";
    }
  }
};
