// Older deployments may contain numeric Unix timestamps while current rows use SQLite datetime text.
// Normalize seconds, milliseconds, and microseconds before comparing different activity kinds.
export const activityOrderBy = `CASE
  WHEN trim(CAST(activity.created_at AS TEXT)) NOT GLOB '*[^0-9.]*' THEN CASE
    WHEN CAST(activity.created_at AS REAL)>=100000000000000 THEN CAST(activity.created_at AS REAL)/1000000
    WHEN CAST(activity.created_at AS REAL)>=100000000000 THEN CAST(activity.created_at AS REAL)/1000
    ELSE CAST(activity.created_at AS REAL)
  END
  ELSE unixepoch(activity.created_at)
END DESC, activity.activity_key DESC`
