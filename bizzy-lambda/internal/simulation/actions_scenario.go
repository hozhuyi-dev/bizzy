package simulation

import (
	"encoding/json"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/shared/docref"
)

// scenarioActions are the user's steps that only matter together, done in
// one go so that runs reach their outcome often: a document is a draft and
// then an issue, and only an issued one can be contradicted. Each step is
// a router call, checked as any user action is.
var scenarioActions = []Action{
	{Name: "scenario.issueDocument", Actor: ActorScenario, Run: func(t *rapid.T, w *World) {
		docType := rapid.SampledFrom([]documents.Type{documents.TypeInvoice, documents.TypeReceipt}).Draw(t, "type")
		slot := documents.Types[docType].Slot
		var src documents.Source
		if rapid.Bool().Draw(t, "a package?") {
			p := pickPackage(t, w, func(p packages.Package) bool {
				return p.Ref(slot) == nil && (slot == docref.SlotInvoice || p.Payment.IsPaid())
			})
			src = documents.Source{Kind: documents.SourcePackage, ID: p.ID}
		} else {
			s := pickSession(t, w, func(s sessions.Session) bool {
				return s.Status == sessions.StatusPriced && s.Ref(slot) == nil && (slot == docref.SlotInvoice || s.Payment.IsPaid())
			})
			src = sessionSource(s.EventID)
		}
		data, refused := w.Call(t, "documents.createDraft", map[string]any{"type": docType, "sources": []documents.Source{src}}, false)
		if refused != nil {
			return
		}
		var d documents.Document
		if err := json.Unmarshal(data, &d); err != nil {
			t.Fatalf("documents.createDraft result: %v", err)
		}
		w.Call(t, "documents.issue", map[string]any{"id": d.ID, "version": d.Version}, true)
	}},
}
