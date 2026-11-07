import { Octokit } from '@octokit/core';

export function apply(ctx) {
  for (const name of ['list_repositories', 'read', 'write']) {
    ctx.tools.register(name, async (input, run) => {
      if (!run.connections) throw new Error('connection-access-denied');
      const api = new Octokit({
        request: {
          fetch: async (url, init) => {
            run.signal.throwIfAborted();
            const result = await run.connections.request({
              provider: 'github', url: String(url), method: init.method,
              ...(init.body === undefined ? {} : { body: init.body }),
            });
            return new Response(result.status === 204 ? null : result.body, { status: result.status, headers: result.headers });
          },
        },
      });
      let result;
      if (name === 'list_repositories') {
        const page = input.page ?? 1;
        const installations = await api.request('GET /user/installations', { per_page: 10, page });
        const accounts = [];
        for (const installation of installations.data.installations ?? []) {
          const repositories = await api.request('GET /user/installations/{installation_id}/repositories', { installation_id: installation.id, per_page: 10 });
          accounts.push({
            installationId: installation.id, account: installation.account?.login,
            totalRepositories: repositories.data.total_count,
            repositories: (repositories.data.repositories ?? []).map(({ id, full_name, private: isPrivate, html_url, default_branch }) => ({ id, full_name, private: isPrivate, html_url, default_branch })),
            nextRepositoryPage: repositories.data.total_count > 10 ? 2 : null,
          });
        }
        result = { accounts, nextInstallationPage: page * 10 < installations.data.total_count ? page + 1 : null };
      } else {
        const query = name === 'read' ? new URLSearchParams({ per_page: '10', ...(input.query ?? {}) }).toString() : '';
        const response = await api.request(`${name === 'read' ? 'GET' : input.method} ${input.path}${query ? '?' + query : ''}`, input.body === undefined ? {} : { data: input.body });
        if (name === 'read') {
          const directory = /^\/repos\/[^/]+\/[^/]+\/contents(?:\/.*)?$/.test(input.path) && Array.isArray(response.data);
          const page = Number(input.query?.page ?? 1), perPage = Number(input.query?.per_page ?? 10);
          result = directory
            ? {
                data: response.data.slice((page - 1) * perPage, page * perPage).map((entry) =>
                  Object.fromEntries(['name', 'path', 'type', 'sha', 'size', 'html_url'].filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]]))),
                pagination: null,
                directory: { page, perPage, totalCount: response.data.length, nextPage: page * perPage < response.data.length ? page + 1 : null, mayBeIncomplete: response.data.length >= 1000 },
              }
            : { data: response.data, pagination: response.headers.link ?? null };
        } else {
          result = { status: response.status, data: response.data == null ? null : Object.fromEntries(['id', 'number', 'sha', 'html_url', 'state', 'merged', 'message', 'commit', 'content'].filter((key) => response.data[key] !== undefined).map((key) => [key, response.data[key]])) };
        }
      }
      if (Buffer.byteLength(JSON.stringify(result)) > 24000) throw new Error('connection-result-too-large: reduce per_page or request a more specific resource; large single files are unsupported');
      return result;
    });
  }
}
