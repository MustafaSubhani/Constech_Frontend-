"""QS assistant: a small tool-calling harness over the project data.

Off by default. Enable with CONSTECH_ASSISTANT=on and a provider (see config.py).
The model reads through tools and can only *propose* changes; the QS applies or rejects
each proposal, and every applied proposal can be undone.
"""
