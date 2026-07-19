"""Shared database connection utilities supporting MySQL and PostgreSQL dynamically."""
import os
import pymysql
from typing import Optional

DB_TYPE = os.getenv("OCR_DB_TYPE", "mysql").lower()
DB_NAME = os.getenv("OCR_DB_NAME", "ocr_v1_00")

DB_CONFIG = {
    "host": os.getenv("OCR_DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("OCR_DB_PORT", "5432" if DB_TYPE == "postgresql" else "3306")),
    "user": os.getenv("OCR_DB_USER", "postgres" if DB_TYPE == "postgresql" else "root"),
    "password": os.getenv("OCR_DB_PASSWORD", "" if DB_TYPE == "postgresql" else ""),
}


class PgCursorWrapper:
    """Wrapper around psycopg2 RealDictCursor to match DictCursor behavior from pymysql."""
    def __init__(self, pg_cursor):
        self.cursor = pg_cursor
        self.lastrowid = None

    def execute(self, query, params=None):
        # Normalize query formatting: MySQL uses backticks `table`, PostgreSQL uses no backticks or double quotes.
        # We replace backticks with empty strings for standard tables.
        query_clean = query.replace("`", "")
        
        # Translate MySQL specific ON DUPLICATE KEY UPDATE to PostgreSQL ON CONFLICT DO UPDATE
        if "ON DUPLICATE KEY UPDATE" in query_clean.upper():
            if "ocr_item_aliases" in query_clean.lower():
                query_clean = """
                    INSERT INTO ocr_item_aliases (vendor_key, raw_name, corrected_name, use_count)
                    VALUES (%s, %s, %s, 1)
                    ON CONFLICT (vendor_key, raw_name) 
                    DO UPDATE SET corrected_name = EXCLUDED.corrected_name, use_count = ocr_item_aliases.use_count + 1
                """
        
        # Intercept INSERT to capture last inserted ID (since psycopg2 cursor doesn't have lastrowid)
        is_insert = query_clean.strip().upper().startswith("INSERT INTO")
        if is_insert and "RETURNING" not in query_clean.upper():
            query_clean = query_clean.strip()
            if query_clean.endswith(";"):
                query_clean = query_clean[:-1]
            query_clean += " RETURNING id"
            
            self.cursor.execute(query_clean, params)
            res = self.cursor.fetchone()
            if res:
                if isinstance(res, dict):
                    self.lastrowid = res.get("id")
                else:
                    self.lastrowid = res[0]
        else:
            self.cursor.execute(query_clean, params)

    def fetchone(self):
        res = self.cursor.fetchone()
        if res and not isinstance(res, dict):
            return dict(res)
        return res

    def fetchall(self):
        res = self.cursor.fetchall()
        return [dict(r) if not isinstance(r, dict) else r for r in res]

    def close(self):
        self.cursor.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def __getattr__(self, name):
        return getattr(self.cursor, name)


class PgConnectionWrapper:
    """Wrapper around psycopg2 connection to mimic pymysql connection structure."""
    def __init__(self, pg_conn):
        self.conn = pg_conn

    def cursor(self, cursorclass=None):
        import psycopg2.extras
        cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        return PgCursorWrapper(cur)

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


def db_connect(database: Optional[str] = DB_NAME):
    """
    Connect to MySQL or PostgreSQL based on OCR_DB_TYPE environment variable.
    """
    if DB_TYPE == "postgresql":
        import psycopg2
        config = dict(DB_CONFIG)
        conn = psycopg2.connect(
            host=config["host"],
            port=config["port"],
            user=config["user"],
            password=config["password"],
            database=database or "postgres"
        )
        return PgConnectionWrapper(conn)
    else:
        # Default to MySQL
        config = dict(DB_CONFIG)
        config["charset"] = "utf8mb4"
        config["cursorclass"] = pymysql.cursors.DictCursor
        if database:
            config["database"] = database
        return pymysql.connect(**config)
