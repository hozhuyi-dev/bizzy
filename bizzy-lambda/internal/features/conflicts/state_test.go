package conflicts

import (
	"testing"

	"bizzy-lambda/internal/platform/statemodel"
)

func TestStates(t *testing.T) {
	statemodel.CheckTable(t, "testdata/states.md", "Conflict", Axes, Rules)
}
