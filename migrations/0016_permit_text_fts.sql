-- אינדקס חיפוש טקסט מלא (FTS5, חיפוש לפי תתי-מחרוזות באורך 3 ומעלה, מתאים לעברית). נפרד כדי שאפשר יהיה להריץ אותו בנפרד.
CREATE VIRTUAL TABLE IF NOT EXISTS permit_doc_fts USING fts5(text, sha256 UNINDEXED, page UNINDEXED, tokenize = 'trigram');
