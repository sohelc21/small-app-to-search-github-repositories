import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

type RepoOwner = {
  login: string;
  avatar_url: string;
  html_url: string;
};

type RepoItem = {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  updated_at: string;
  owner: RepoOwner;
};

type SearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: RepoItem[];
};

type SortOption = "" | "stars" | "forks" | "help-wanted-issues" | "updated";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatNumber(n: number) {
  return n.toLocaleString();
}

function timeAgo(dateISO: string) {
  const d = new Date(dateISO).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - d);
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 365) return `${days}d ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

function buildSearchUrl(params: {
  q: string;
  sort: SortOption;
  order: "desc" | "asc";
  perPage: number;
  page: number;
}) {
  const usp = new URLSearchParams();
  usp.set("q", params.q);
  if (params.sort) usp.set("sort", params.sort);
  if (params.sort) usp.set("order", params.order); // GitHub ignores order unless sort is provided
  usp.set("per_page", String(params.perPage));
  usp.set("page", String(params.page));
  return `https://api.github.com/search/repositories?${usp.toString()}`;
}

async function githubSearchRepos(args: {
  q: string;
  sort: SortOption;
  order: "desc" | "asc";
  perPage: number;
  page: number;
  token?: string;
  signal: AbortSignal;
}): Promise<{ data: SearchResponse; rateLimit?: { remaining?: string; reset?: string } }> {
  const url = buildSearchUrl(args);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (args.token?.trim()) headers.Authorization = `Bearer ${args.token.trim()}`;

  const res = await fetch(url, { headers, signal: args.signal });

  const rateLimit = {
    remaining: res.headers.get("x-ratelimit-remaining") ?? undefined,
    reset: res.headers.get("x-ratelimit-reset") ?? undefined,
  };

  if (!res.ok) {
    let msg = `GitHub API error (${res.status})`;
    try {
      const j = await res.json();
      if (j?.message) msg = `${msg}: ${j.message}`;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as SearchResponse;
  return { data, rateLimit };
}

export default function App() {
  const [query, setQuery] = useState("react typescript");
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  const [sort, setSort] = useState<SortOption>("stars");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);

  // optional token (stored only in sessionStorage so it won’t persist forever)
  const [token, setToken] = useState(() => sessionStorage.getItem("gh_token") ?? "");

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rateRemaining, setRateRemaining] = useState<string | undefined>();
  const [rateReset, setRateReset] = useState<string | undefined>();

  const abortRef = useRef<AbortController | null>(null);

  // debounce typing
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(t);
  }, [query]);

  // persist token
  useEffect(() => {
    sessionStorage.setItem("gh_token", token);
  }, [token]);

  // compute pagination bounds
  const totalCount = data?.total_count ?? 0;
  const effectiveTotal = Math.min(totalCount, 1000); // GitHub Search cap
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / perPage));
  const safePage = clamp(page, 1, totalPages);

  const pageButtons = useMemo(() => {
    const maxButtons = 7;
    const half = Math.floor(maxButtons / 2);
    let start = Math.max(1, safePage - half);
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    const nums: number[] = [];
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  }, [safePage, totalPages]);

  useEffect(() => {
    if (!debouncedQuery) {
      setData(null);
      setErr(null);
      return;
    }

    setLoading(true);
    setErr(null);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    githubSearchRepos({
      q: debouncedQuery,
      sort,
      order,
      perPage,
      page: safePage,
      token,
      signal: ac.signal,
    })
      .then(({ data, rateLimit }) => {
        setData(data);
        setRateRemaining(rateLimit?.remaining);
        setRateReset(rateLimit?.reset);
      })
      .catch((e: any) => {
        if (e?.name === "AbortError") return;
        setErr(e?.message ?? String(e));
        setData(null);
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [debouncedQuery, sort, order, perPage, safePage, token]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedQuery(query.trim());
    setPage(1);
  };

  const resetTime =
    rateReset ? new Date(Number(rateReset) * 1000).toLocaleTimeString() : undefined;

  return (
    <div className="appShell">
      <header className="header">
        <div className="brand">
          <div className="logo" aria-hidden />
          <div>
            <h1>GitHub Repo Search</h1>
            <p className="muted">
              Search repositories via GitHub REST API · Pagination, sort, debounce
            </p>
          </div>
        </div>
        <a
          className="docLink"
          href="https://docs.github.com/en/rest/reference/search"
          target="_blank"
          rel="noreferrer"
        >
          API docs ↗
        </a>
      </header>

      <main className="card">
        <form className="controls" onSubmit={onSubmit}>
          <div className="field wide">
            <label>Query</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='e.g. "tetris language:assembly stars:>500"'
              spellCheck={false}
            />
            <div className="hint">
              Tip: use GitHub qualifiers like <code>language:</code>, <code>stars:</code>,{" "}
              <code>user:</code>, <code>topic:</code>
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>Sort</label>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortOption)}>
                <option value="">Best match</option>
                <option value="stars">Stars</option>
                <option value="forks">Forks</option>
                <option value="help-wanted-issues">Help wanted issues</option>
                <option value="updated">Recently updated</option>
              </select>
            </div>

            <div className="field">
              <label>Order</label>
              <select value={order} onChange={(e) => setOrder(e.target.value as any)} disabled={!sort}>
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>

            <div className="field">
              <label>Per page</label>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <button className="btn" type="submit">
              Search
            </button>
          </div>

          <details className="tokenBox">
            <summary>Optional: add a GitHub token (higher rate limit)</summary>
            <div className="tokenInner">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste fine-grained PAT (repo read not required for public search)"
                spellCheck={false}
              />
              <button className="btn secondary" type="button" onClick={() => setToken("")}>
                Clear
              </button>
            </div>
            <div className="hint">
              Stored in <code>sessionStorage</code> only. Don’t ship real apps like this—use a backend.
            </div>
          </details>
        </form>

        <div className="statusRow">
          {loading ? (
            <span className="pill">Loading…</span>
          ) : err ? (
            <span className="pill danger">{err}</span>
          ) : data ? (
            <span className="pill ok">
              {formatNumber(totalCount)} results {totalCount > 1000 ? "(showing first 1000 max)" : ""}
            </span>
          ) : (
            <span className="pill">Type a query to search</span>
          )}

          <span className="muted small">
            Rate limit remaining: <b>{rateRemaining ?? "?"}</b>
            {resetTime ? <> · reset at <b>{resetTime}</b></> : null}
          </span>
        </div>

        {data?.items?.length ? (
          <>
            <ul className="results">
              {data.items.map((r) => (
                <li key={r.id} className="result">
                  <div className="resultTop">
                    <img className="avatar" src={r.owner.avatar_url} alt="" />
                    <div className="resultMain">
                      <a className="repoName" href={r.html_url} target="_blank" rel="noreferrer">
                        {r.full_name}
                      </a>
                      <div className="desc">{r.description ?? <span className="muted">No description</span>}</div>
                      <div className="meta">
                        <span>★ {formatNumber(r.stargazers_count)}</span>
                        <span>⑂ {formatNumber(r.forks_count)}</span>
                        <span>Issues {formatNumber(r.open_issues_count)}</span>
                        {r.language ? <span className="tag">{r.language}</span> : null}
                        <span className="muted">Updated {timeAgo(r.updated_at)}</span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="pager">
              <button
                className="btn secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1 || loading}
              >
                ← Prev
              </button>

              <div className="pages">
                {pageButtons[0] > 1 ? (
                  <>
                    <button className="pageBtn" onClick={() => setPage(1)} disabled={loading}>
                      1
                    </button>
                    <span className="ellipsis">…</span>
                  </>
                ) : null}

                {pageButtons.map((n) => (
                  <button
                    key={n}
                    className={`pageBtn ${n === safePage ? "active" : ""}`}
                    onClick={() => setPage(n)}
                    disabled={loading}
                  >
                    {n}
                  </button>
                ))}

                {pageButtons[pageButtons.length - 1] < totalPages ? (
                  <>
                    <span className="ellipsis">…</span>
                    <button className="pageBtn" onClick={() => setPage(totalPages)} disabled={loading}>
                      {totalPages}
                    </button>
                  </>
                ) : null}
              </div>

              <button
                className="btn secondary"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages || loading}
              >
                Next →
              </button>
            </div>
          </>
        ) : data && !loading && !err ? (
          <div className="empty">No results found.</div>
        ) : null}
      </main>

      <footer className="footer muted small">
        Built with React + TypeScript · Uses GitHub Search REST API (q/sort/order/per_page/page). :contentReference[oaicite:3]{index=3}
      </footer>
    </div>
  );
}
