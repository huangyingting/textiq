---
type: "reference"
status: "current"
last_updated: "2026-10-23"
---

# TextIQ

TextIQ combines authored documents, presentations, and shared workspaces.

## Language

**Document**:
An authored work owned by one user, optionally shared with a workspace or through
a public link. Its owner retains ownership when workspace membership changes.

**Workspace**:
A shared collection of documents with one owner and members who can view or edit.
Workspace ownership does not transfer ownership of the documents it contains.

**Workspace role**:
A member's authority within a workspace: viewer or editor. The workspace owner
has separate authority and is not an additional membership role.

**Workspace invitation**:
A link that grants workspace membership to a signed-in user. It is not an
invitation to create an account and does not make account registration private.

**Presentation**:
The editable slides associated with a document, including their layout, theme,
speaker notes, and media.
_Avoid_: Visual

**Visual**:
A structured diagram or chart embedded in a document or used in a presentation.
_Avoid_: Presentation

**Document version**:
A retained point-in-time copy of a document's authored content and presentation,
used to recover earlier work.

**Document asset**:
Protected media belonging to one document. An independent duplicate must not
depend on the original document remaining accessible or retained.
