package table_test

import (
	"testing"

	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/table/tabletest"
)

func TestMemory(t *testing.T) {
	tabletest.Run(t, func(*testing.T) (table.Table, string) { return table.NewMemory(), "" })
}
