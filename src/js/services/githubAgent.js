// src/js/services/githubAgent.js

export class GitHubAgentEngine {
  constructor(token) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    };
  }

  async fetchWithRetry(url, options = {}, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const res = await fetch(url, { ...options, headers: this.headers });
        if (res.status === 401 || res.status === 403) {
          const err = await res.json();
          throw new Error(`GitHub Auth Error: ${err.message}`);
        }
        return res;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  async listUserRepos() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/user/repos?per_page=100&sort=updated`);
    if (!res.ok) throw new Error("Gagal mengambil daftar repositori");
    return await res.json();
  }

  async getRepoTree(owner, repo, branch = "main") {
    const branchRes = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/branches/${branch}`);
    const branchData = await branchRes.json();
    const latestCommitSha = branchData.commit.sha;

    const treeRes = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/git/trees/${latestCommitSha}?recursive=1`);
    const treeData = await treeRes.json();

    return {
      baseCommitSha: latestCommitSha,
      tree: (treeData.tree || []).filter(item => item.type === "blob")
    };
  }

  async readFileContent(owner, repo, path, branch = "main") {
    const res = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
    if (!res.ok) throw new Error(`File "${path}" tidak ditemukan di repository`);
    const data = await res.json();
    return decodeURIComponent(escape(atob(data.content)));
  }

  async createPRWithChanges({ owner, repo, baseBranch, newBranchName, commitMessage, prTitle, prBody, modifiedFiles }) {
    const refRes = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
    const refData = await refRes.json();
    const baseCommitSha = refData.object.sha;

    const commitRes = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/git/commits/${baseCommitSha}`);
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    const treePayload = [];
    for (const file of modifiedFiles) {
      const blobRes = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: "utf-8" })
      });
      const blobData = await blobRes.json();
      treePayload.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobData.sha
      });
    }

    const newTreeRes = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treePayload })
    });
    const newTreeData = await newTreeRes.json();

    const newCommitRes = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: commitMessage,
        tree: newTreeData.sha,
        parents: [baseCommitSha]
      })
    });
    const newCommitData = await newCommitRes.json();

    await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${newBranchName}`,
        sha: newCommitData.sha
      })
    });

    const prRes = await this.fetchWithRetry(`${this.baseUrl}/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: newBranchName,
        base: baseBranch
      })
    });

    return await prRes.json();
  }
}
