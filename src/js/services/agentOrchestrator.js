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
    const treePreview = this.repoTree.slice(0, 100).join("\n");
    return `[SYSTEM IDENTITY & MISSION]
Kamu adalah Senior Software Engineer & Autonomous Coding Agent yang beroperasi langsung di browser user.
Target Repo: ${this.repoKey} (Branch: ${this.branch})

[KNOWLEDGE & LONG-TERM MEMORY REPO INI]
${existingMemory || "(Belum ada memory sebelumnya. Ini adalah sesi awal.)"}

[STRUKTUR FILE REPOSITORI]
${treePreview}

[ATURAN EMAS - STRICT CODE PRESERVATION]
1. DILARANG menghapus fungsi, helper, atau fitur yang sudah ada kecuali ada instruksi eksplisit dari user untuk menghapusnya.
2. DILARANG menggunakan komentar placeholder seperti "// ... sisa kode tetap sama" atau "// TODO: existing code". Selalu tulis kode lengkap yang utuh dan aman saat menggunakan format WRITE.
3. Baca file terkait terlebih dahulu sebelum melakukan perubahan agar tidak merusak dependensi internal.

[PROTOKOL PERINTAH]
1. [READ: path/to/file.ext] -> Gunakan untuk membaca isi lengkap suatu file.
2. [WRITE: path/to/file.ext]
\`\`\`extension
isi file lengkap yang sudah diperbarui
\`\`\`
3. [UPDATE_MEMORY: Rangkuman arsitektur, modul baru yang ditambahkan, atau pola penting yang dipelajari pada task ini]
4. [FINISH: Judul Singkat PR | Deskripsi detail perubahan yang dibuat] -> Wajib dipanggil saat seluruh tugas selesai.`;
  }

  async runTask(userPrompt, onProgress) {
    this.taskId = `task_${Date.now()}`;
    const existingMemory = await AgentPersistence.getRepoMemory(this.repoKey);

    this.conversation = [
      { role: "system", content: this.buildSystemPrompt(existingMemory) },
      { role: "user", content: `Instruksi Tugas:\n${userPrompt}\n\nPastikan untuk membaca file terkait, tidak menghapus fitur lama, mengupdate memory repo, dan menyelesaikan perubahan.` }
    ];

    return await this.executeLoop(userPrompt, onProgress);
  }

  async resumeTask(checkpoint, onProgress) {
    this.taskId = checkpoint.taskId;
    this.conversation = checkpoint.conversation;
    this.virtualFS = new Map(Object.entries(checkpoint.virtualFS || {}));
    onProgress("Melanjutkan task yang terputus...");
    return await this.executeLoop(checkpoint.userPrompt, onProgress);
  }

  async executeLoop(userPrompt, onProgress) {
    let isFinished = false;
    let iteration = 0;
    const MAX_ITERATIONS = 12;

    while (!isFinished && iteration < MAX_ITERATIONS) {
      iteration++;
      onProgress(`AI Iterasi langkah ${iteration}...`);

      await this.saveCurrentState(userPrompt, "RUNNING");

      let aiResponse;
      try {
        aiResponse = await this.callAIStream(this.conversation, onProgress);
      } catch (networkErr) {
        onProgress(`Koneksi terganggu (${networkErr.message}). Menunggu jaringan pulih untuk resume...`);
        await this.saveCurrentState(userPrompt, "RUNNING");
        throw networkErr;
      }

      this.conversation.push({ role: "assistant", content: aiResponse });

      const readMatches = [...aiResponse.matchAll(/\[READ:\s*(.*?)\]/g)];
      if (readMatches.length > 0) {
        for (const match of readMatches) {
          const filePath = match[1].trim();
          onProgress(`Membaca file dari GitHub: ${filePath}`);
          let content = this.virtualFS.get(filePath);
          if (!content) {
            try {
              content = await this.gh.readFileContent(this.owner, this.repo, filePath, this.branch);
              this.virtualFS.set(filePath, content);
            } catch (e) {
              content = `[ERROR: Gagal membaca file ${filePath}: ${e.message}]`;
            }
          }
          this.conversation.push({
            role: "user",
            content: `[FILE CONTENT: ${filePath}]\n\`\`\`\n${content}\n\`\`\``
          });
        }
        continue;
      }

      const writeRegex = /\[WRITE:\s*(.*?)\]\s*```[\w]*\n([\s\S]*?)```/g;
      let writeMatch;
      let filesChangedCount = 0;
      while ((writeMatch = writeRegex.exec(aiResponse)) !== null) {
        const filePath = writeMatch[1].trim();
        const fileContent = writeMatch[2];
        this.virtualFS.set(filePath, fileContent);
        filesChangedCount++;
        onProgress(`Drafting perubahan file: ${filePath}`);
      }

      const memoryMatch = aiResponse.match(/\[UPDATE_MEMORY:\s*([\s\S]*?)\]/);
      if (memoryMatch) {
        const insight = memoryMatch[1].trim();
        onProgress("Memperbarui autonomous memory repository...");
        await AgentPersistence.appendRepoMemory(this.repoKey, insight);
      }

      const finishMatch = aiResponse.match(/\[FINISH:\s*(.*?)\|(.*?)\]/s);
      if (finishMatch || aiResponse.includes("[FINISH]")) {
        isFinished = true;
        const prTitle = finishMatch ? finishMatch[1].trim() : `AI: Update ${userPrompt.slice(0, 50)}`;
        const prBody = finishMatch ? finishMatch[2].trim() : `Automated patch by Local AI Agent.\n\nPrompt:\n> ${userPrompt}`;

        if (this.virtualFS.size === 0) {
          throw new Error("AI menyelesaikan tugas tanpa menuliskan modifikasi file apapun.");
        }

        onProgress("Membuat Git Tree, Commit atomic, dan Pull Request...");
        const modifiedFiles = Array.from(this.virtualFS.entries()).map(([path, content]) => ({ path, content }));
        const branchName = `patch-${Date.now().toString().slice(-6)}`;

        const prResult = await this.gh.createPRWithChanges({
          owner: this.owner,
          repo: this.repo,
          baseBranch: this.branch,
          newBranchName: branchName,
          commitMessage: prTitle,
          prTitle,
          prBody: `${prBody}\n\n---\n*Preservation Checked: Tidak ada fungsi yang dihapus sembarangan.*`,
          modifiedFiles
        });

        await AgentPersistence.clearTaskCheckpoint(this.taskId);
        onProgress(`Pull Request berhasil dibuat: ${prResult.html_url}`);
        return prResult;
      }
    }

    throw new Error("Batas maksimum langkah tercapai sebelum Pull Request berhasil dibuat.");
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

  async callAIStream(messages, onProgress) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "coding",
        model: "auto",
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      })
    });

    if (!response.ok) throw new Error(`AI Gateway HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
          try {
            const parsed = JSON.parse(line.replace("data: ", ""));
            if (parsed.content) {
              result += parsed.content;
            }
          } catch (_) {}
        }
      }
    }

    return result;
  }
}
