"""Fern: the Conservatory's worker.

Fern owns the database schema, drains the identification queue, and calls
Pl@ntNet. Later phases add the enrichment pass. The web app (web/) reads and
writes the same SQLite file but never creates tables.
"""
