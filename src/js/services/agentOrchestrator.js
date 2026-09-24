// src/js/services/agentOrchestrator.js

import { AgentPersistence } from "./agentPersistence.js";

export class BrowserAgentOrchestrator {
  constructor(githubEngine, owner, repo, branch = "main") {
    this.gh = githubEngine;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.repoKey = `${owner}/${repo}`;

    this.taskId = null;
    this.virtualFS = new Map();
    this.conversation = [];
    this.repoTree = [];
  }

  async initialize() {
    const { tree } = await this.gh.getRepoTree(this.owner, this.repo, this.branch);
    this.repoTree = tree.map((item) => item.path);
  }

  buildSystemPrompt(existingMemory) {
    const treePreview = this.repoTree.slice(0, 150).join("\n");
    return `[SYSTEM IDENTITY & MISSION]
Kamu adalah Senior Autonomous Coding Agent bertenaga NVIDIA Nemotron 30B (Thinking Mode).
Target Repository: ${this.repoKey} (Branch: ${this.branch})

[REPOSITORY LONG-TERM MEMORY]
${existingMemory || "(Belum ada memory sebelumnya. Ini adalah sesi awal.)"}

[FILE STRUCTURE PREVIEW]
${treePreview}

[ATURAN UTAMA - STRICT PRESERVATION & DIRECT COMPLETION]
1. Selesaikan seluruh analisa dan penulisan berkas secara utuh sampai tuntas dalam SATU fase eksekusi lengkap.
2. DILARANG menghapus fungsi atau logika lama kecuali diinstruksikan eksplisit.
3. Tuliskan SELURUH isi file yang dimodifikasi tanpa placeholder ("// TODO", "// keep existing").
4. Gunakan format output berikut:

[WRITE: path/to/file.ext]
\`\`\`extension
// isi kode utuh
\`\`\`

[UPDATE_MEMORY: Catatan arsitektur/pola baru yang dipelajari]
[FINISH: Judul PR | Deskripsi detail perubahan]`;
  }

  async runTask(userPrompt, onProgress, onReasoning, onContent) {
    this.taskId = `task_${Date.now()}`;
    const existingMemory = await AgentPersistence.getRepoMemory(this.repoKey);

    onProgress("Mengumpulkan dependensi dan struktur file repositori...");

    // Muat konten awal dari berkas utama yang kemungkinan besar relevan
    const relevantPaths = this.repoTree.filter(p => 
      !p.includes("node_modules") && 
      !p.includes(".lock") && 
      (p.endsWith(".js") || p.endsWith(".json") || p.endsWith(".html") || p.endsWith(".css"))
    ).slice(0, 8);

    let initialFileContext = "";
    for (const filePath of relevantPaths) {
      try {
        const content = await this.gh.readFileContent(this.owner, this.repo, filePath, this.branch);
        this.virtualFS.set(filePath, content);
        initialFileContext += `\n[FILE: ${filePath}]\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\`\n`;
      } catch (_) {}
    }

    this.conversation = [
      { role: "system", content: this.buildSystemPrompt(existingMemory) },
      { 
        role: "user", 
        content: `Instruksi Tugas:\n${userPrompt}\n\nBerikut konteks file yang dimuat:\n${initialFileContext}\n\nAnalisa secara menyeluruh, modifikasi berkas terkait dengan format [WRITE: path], perbarui memory repositori, dan selesaikan dengan [FINISH: Judul PR | Deskripsi].` 
      }
    ];

    return await this.executeDirectPass(userPrompt, onProgress, onReasoning, onContent);
  }

  async resumeTask(checkpoint, onProgress, onReasoning, onContent) {
    this.taskId = checkpoint.taskId;
    this.conversation = checkpoint.conversation;
    this.virtualFS = new Map(Object.entries(checkpoint.virtualFS || {}));
    onProgress("Melanjutkan proses reasoning dan pembuatan patch PR...");
    return await this.executeDirectPass(checkpoint.userPrompt, onProgress, onReasoning, onContent);
  }

  async executeDirectPass(userPrompt, onProgress, onReasoning, onContent) {
    await this.saveCurrentState(userPrompt, "RUNNING");
    onProgress("Model Nemotron sedang melakukan deep reasoning & penulisan kode...");

    let aiFullResponse = "";
    try {
      aiFullResponse = await this.callAIStream(this.conversation, onReasoning, onContent);
    } catch (err) {
      await this.saveCurrentState(userPrompt, "FAILED");
      throw err;
    }

    this.conversation.push({ role: "assistant", content: aiFullResponse });

    // Parse seluruh WRITE block
    const writeRegex = /\[WRITE:\s*(.*?)\]\s*```[\w]*\n([\s\S]*?)```/g;
    let writeMatch;
    let filesWritten = 0;

    while ((writeMatch = writeRegex.exec(aiFullResponse)) !== null) {
      const filePath = writeMatch[1].trim();
      const fileContent = writeMatch[2];
      this.virtualFS.set(filePath, fileContent);
      filesWritten++;
    }

    // Parse UPDATE_MEMORY
    const memoryMatch = aiFullResponse.match(/\[UPDATE_MEMORY:\s*([\s\S]*?)\]/);
    if (memoryMatch) {
      const insight = memoryMatch[1].trim();
      await AgentPersistence.appendRepoMemory(this.repoKey, insight);
    }

    // Parse FINISH & Commit PR
    const finishMatch = aiFullResponse.match(/\[FINISH:\s*(.*?)\|(.*?)\]/s);
    const prTitle = finishMatch ? finishMatch[1].trim() : `AI Patch: ${userPrompt.slice(0, 50)}`;
    const prBody = finishMatch ? finishMatch[2].trim() : `Automated patch by Nemotron Coding Agent.\n\nPrompt:\n> ${userPrompt}`;

    if (this.virtualFS.size === 0) {
      throw new Error("AI tidak menghasilkan blok modifikasi file [WRITE: ...].");
    }

    onProgress("Membuat atomic commit dan menerbitkan Pull Request...");
    const modifiedFiles = Array.from(this.virtualFS.entries()).map(([path, content]) => ({ path, content }));
    const branchName = `ai-patch-${Date.now().toString().slice(-6)}`;

    const prResult = await this.gh.createPRWithChanges({
      owner: this.owner,
      repo: this.repo,
      baseBranch: this.branch,
      newBranchName: branchName,
      commitMessage: prTitle,
      prTitle,
      prBody: `${prBody}\n\n---\n*Generated autonomously with NVIDIA Nemotron 30B (Thinking Mode).*`,
      modifiedFiles
    });

    await AgentPersistence.clearTaskCheckpoint(this.taskId);
    onProgress(`Pull Request berhasil dibuat!`);
    return prResult;
  }

  async saveCurrentState(userPrompt, status) {
    const vfsObject = Object.fromEntries(this.virtualFS.entries());
    await AgentPersistence.saveTaskCheckpoint({
      taskId: this.taskId,
      repoKey: this.repoKey,
      branch: this.branch,
      userPrompt,
      conversation: this.conversation,
      virtualFS: vfsObject,
      status
    });
  }

  async callAIStream(messages, onReasoning, onContent) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "coding",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      })
    });

    if (!response.ok) throw new Error(`AI Gateway Error HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let accumulatedContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split(/\r?\n/);

      for (const line of lines) {
        if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
          try {
            const parsed = JSON.parse(line.replace("data: ", ""));
            if (parsed.reasoning && onReasoning) {
              onReasoning(parsed.reasoning);
            }
            if (parsed.content) {
              accumulatedContent += parsed.content;
              if (onContent) onContent(parsed.content);
            }
          } catch (_) {}
        }
      }
    }

    return accumulatedContent;
  }
}
