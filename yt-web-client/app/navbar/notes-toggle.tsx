"use client";

import { useEffect, useState } from "react";
import {
  getNotesFeatureFlag,
  setNotesFeatureFlag,
} from "../firebase/functions";
import styles from "./notes-toggle.module.css";

export default function NotesToggle() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const flag = await getNotesFeatureFlag();
        if (isMounted) {
          setEnabled(flag);
        }
      } catch (err) {
        setError("Unable to load notes flag");
        console.error(err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const toggle = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = !enabled;
      const result = await setNotesFeatureFlag(next);
      setEnabled(result);
    } catch (err) {
      setError("Failed to update notes flag");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.toggleContainer}>
      <span className={styles.statusText}>
        Notes generation: {enabled ? "On" : "Off"}
      </span>
      <button
        className={`${styles.toggleButton} ${enabled ? styles.enabled : ""}`}
        onClick={toggle}
        disabled={loading}
      >
        {loading ? "Working..." : enabled ? "Disable" : "Enable"}
      </button>
      {error && <span className={styles.statusText}>{error}</span>}
    </div>
  );
}
