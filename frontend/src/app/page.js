"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [maxResults, setMaxResults] = useState(100);
  const [scrapeEmails, setScrapeEmails] = useState(true);
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startScrape = async (e) => {
    e.preventDefault();
    setError("");
    if (!keyword.trim() || !location.trim()) {
      setError("Keyword and location are required.");
      return;
    }
    stopPolling();
    setJob(null);
    setRunning(true);
    try {
      const res = await fetch(`${API_BASE}/api/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          location: location.trim(),
          maxResults: Number(maxResults),
          scrapeEmails,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start scrape");
      setJob(data.job);
      beginPolling(data.job.id);
    } catch (err) {
      setError(err.message);
      setRunning(false);
    }
  };

  const beginPolling = (jobId) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
        const data = await res.json();
        setJob(data.job);
        if (data.job.status === "completed" || data.job.status === "failed") {
          stopPolling();
          setRunning(false);
        }
      } catch {
        // transient network error, keep polling
      }
    }, 2500);
  };

  useEffect(() => () => stopPolling(), [stopPolling]);

  const downloadCsv = () => {
    if (!job || job.status !== "completed") return;
    window.open(`${API_BASE}/api/jobs/${job.id}/download/csv`, "_blank");
  };

  const progress = job?.progress || {};
  const businesses = job?.result?.businesses || [];
  const status = job?.status || "idle";

  return (
    <main style={styles.wrap}>
      <h1 style={styles.title}>Google Maps Lead Scraper</h1>

      <form onSubmit={startScrape} style={styles.form}>
        <div style={styles.row}>
          <label style={styles.field}>
            <span style={styles.label}>Keyword</span>
            <input
              style={styles.input}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. Dentist"
            />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Location</span>
            <input
              style={styles.input}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Dallas, Texas"
            />
          </label>
          <label style={styles.fieldSmall}>
            <span style={styles.label}>Max results</span>
            <input
              style={styles.input}
              type="number"
              min={1}
              max={500}
              value={maxResults}
              onChange={(e) => setMaxResults(e.target.value)}
            />
            <span style={styles.hint}>Maps limit ~120-200</span>
          </label>
        </div>
        <div style={styles.rowBetween}>
          <label style={styles.check}>
            <input
              type="checkbox"
              checked={scrapeEmails}
              onChange={(e) => setScrapeEmails(e.target.checked)}
            />
            Enrich websites with emails
          </label>
          <button type="submit" style={styles.button} disabled={running}>
            {running ? "Scraping…" : "Start Scraping"}
          </button>
        </div>
      </form>

      {error && <p style={styles.error}>{error}</p>}

      {running && status !== "completed" && status !== "failed" && (
        <div style={styles.statusBox}>
          <p>
            Status: <strong>{status}</strong> —{" "}
            {progress.text || `${progress.stage}: ${progress.found || 0}/${progress.total || "…"}`}
          </p>
          {progress.total ? (
            <div style={styles.bar}>
              <div
                style={{
                  ...styles.barFill,
                  width: `${Math.min(100, ((progress.found || 0) / progress.total) * 100)}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      )}

      {status === "failed" && (
        <div style={styles.statusBoxErr}>
          <p>Scrape failed: {job?.error}</p>
        </div>
      )}

      {status === "completed" && (
        <div style={styles.statusBoxDone}>
          <p>
            Done. Scraped <strong>{job?.result?.meta?.scraped}</strong> businesses in{" "}
            <strong>{((job?.result?.meta?.durationMs || 0) / 1000).toFixed(1)}s</strong>.
          </p>
          <button style={styles.buttonSmall} onClick={downloadCsv}>
            Download CSV
          </button>
        </div>
      )}

      {businesses.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.th}>
                <th>Name</th>
                <th>Category</th>
                <th>Address</th>
                <th>Phone</th>
                <th>Website</th>
                <th>Google Maps</th>
                <th>Rating</th>
                <th>Reviews</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b, i) => (
                <tr key={i} style={styles.td}>
                  <td style={{ fontWeight: 600 }}>{b.title}</td>
                  <td>{b.category}</td>
                  <td>{b.address}</td>
                  <td>{b.phone || "-"}</td>
                  <td>
                    {b.website ? (
                      <a
                        href={b.website.startsWith("http") ? b.website : `https://${b.website}`}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.link}
                      >
                        {b.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    {b.url ? (
                      <a href={b.url} target="_blank" rel="noreferrer" style={styles.link}>
                        View on Maps ↗
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{b.rating ? `⭐ ${b.rating}` : "-"}</td>
                  <td>{b.reviews || "-"}</td>
                  <td>{b.email || (b.emails || []).join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const styles = {
  wrap: {
    maxWidth: 1100,
    margin: "40px auto",
    padding: "0 20px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: "#1a1a1a",
  },
  title: { fontSize: 28, marginBottom: 24 },
  form: { border: "1px solid #ddd", borderRadius: 8, padding: 20, marginBottom: 24 },
  row: { display: "flex", gap: 16, flexWrap: "wrap" },
  rowBetween: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    flexWrap: "wrap",
    gap: 12,
  },
  field: { flex: 1, minWidth: 220, display: "flex", flexDirection: "column" },
  fieldSmall: { width: 140, display: "flex", flexDirection: "column" },
  label: { marginBottom: 6, fontSize: 13, fontWeight: 600 },
  input: {
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 6,
  },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  button: {
    padding: "12px 24px",
    fontSize: 15,
    fontWeight: 600,
    background: "#1a73e8",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
  buttonSmall: {
    padding: "8px 16px",
    fontSize: 14,
    fontWeight: 600,
    background: "#1a73e8",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    marginLeft: 12,
  },
  error: { color: "#c0392b", marginBottom: 16 },
  statusBox: {
    border: "1px solid #d0e0ff",
    background: "#f2f6ff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  statusBoxErr: {
    border: "1px solid #f0c0c0",
    background: "#fff0f0",
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  statusBoxDone: {
    border: "1px solid #c9e8c9",
    background: "#f0faf0",
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
    display: "flex",
    alignItems: "center",
  },
  bar: { background: "#e0e7f2", borderRadius: 6, height: 10, marginTop: 10, overflow: "hidden" },
  barFill: { background: "#1a73e8", height: "100%", transition: "width 0.3s" },
  tableWrap: { overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: "2px solid #ddd",
    background: "#f7f8fa",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #eee",
    verticalAlign: "top",
  },
  link: {
    color: "#1a73e8",
    textDecoration: "none",
    fontWeight: 500,
  },
  hint: {
    fontSize: 11,
    color: "#888",
    marginTop: 4,
  },
};
