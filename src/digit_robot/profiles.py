"""Explicit profile preferences only; conversation history is never persisted here."""
from contextlib import contextmanager
from pathlib import Path
import sqlite3
from typing import Any, Iterator
import uuid

from .voice import VoiceError


class ProfileStore:
    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise VoiceError('profile_store_unavailable', '档案存储暂不可用', 503) from error
        with self.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS profiles ('
                       'profile_id TEXT PRIMARY KEY, display_name TEXT UNIQUE NOT NULL, '
                       'preferred_name TEXT, communication_style TEXT)')

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        db = None
        try:
            db = sqlite3.connect(self.path, timeout=.1)
            db.row_factory = sqlite3.Row
            with db:
                yield db
        except sqlite3.Error as error:
            raise VoiceError('profile_store_unavailable', '档案存储暂不可用，请稍后重试', 503) from error
        finally:
            if db is not None:
                db.close()

    @staticmethod
    def fields(data: Any, limits: dict[str, int], *, nullable: bool = False) -> dict[str, Any]:
        if not isinstance(data, dict) or not data or set(data) - set(limits):
            raise VoiceError('invalid_profile_input', '档案字段无效', 422)
        result: dict[str, Any] = {}
        for key, value in data.items():
            if nullable and value is None:
                result[key] = None
                continue
            if not isinstance(value, str):
                raise VoiceError('invalid_profile_input', '档案字段类型或长度无效', 422)
            value = value.strip()
            if len(value) > limits[key]:
                raise VoiceError('invalid_profile_input', '档案字段类型或长度无效', 422)
            if not value and not nullable:
                raise VoiceError('invalid_profile_input', '档案名称不能为空', 422)
            result[key] = value or None
        return result

    @staticmethod
    def _get(db: sqlite3.Connection, profile_id: str) -> dict[str, Any]:
        row = db.execute('SELECT * FROM profiles WHERE profile_id=?', (profile_id,)).fetchone()
        if row is None:
            raise VoiceError('profile_not_found', '档案不存在', 404)
        return {'profile_id': row['profile_id'], 'display_name': row['display_name'],
                'preferences': {key: row[key] for key in ('preferred_name', 'communication_style')}}

    def get(self, profile_id: str) -> dict[str, Any]:
        with self.connection() as db:
            return self._get(db, profile_id)

    def list(self) -> list[dict[str, Any]]:
        with self.connection() as db:
            db.execute('BEGIN')
            ids = db.execute('SELECT profile_id FROM profiles ORDER BY display_name, profile_id').fetchall()
            return [self._get(db, row['profile_id']) for row in ids]

    def create(self, data: Any) -> dict[str, Any]:
        values = self.fields(data, {'display_name': 80})
        with self.connection() as db:
            pid = str(uuid.uuid4())
            try:
                db.execute('INSERT INTO profiles(profile_id,display_name) VALUES (?,?)', (pid, values['display_name']))
            except sqlite3.IntegrityError as error:
                raise VoiceError('profile_exists', '同名档案已存在', 409) from error
            return self._get(db, pid)

    def update(self, profile_id: str, data: Any, *, preferences: bool) -> dict[str, Any]:
        values = self.fields(data, {'preferred_name': 80, 'communication_style': 500} if preferences else {'display_name': 80}, nullable=preferences)
        with self.connection() as db:
            self._get(db, profile_id)
            try:
                db.execute('UPDATE profiles SET ' + ','.join(f'{key}=?' for key in values) + ' WHERE profile_id=?',
                           (*values.values(), profile_id))
            except sqlite3.IntegrityError as error:
                raise VoiceError('profile_exists', '同名档案已存在', 409) from error
            return self._get(db, profile_id)

    def delete(self, profile_id: str) -> None:
        with self.connection() as db:
            self._get(db, profile_id)
            db.execute('DELETE FROM profiles WHERE profile_id=?', (profile_id,))
