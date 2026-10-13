import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { DOCUMENT_TYPES } from "../../documents.constant";
import { documentLabel } from "../../documents.util";
import type { DocumentPdfProps } from "../../documents.types";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

/**
 * The one layout every document type prints with: business header, who it is
 * for, the lines, the total, then type-specific extras. Kept free of app UI
 * imports so it only loads when a PDF is made.
 */

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, lineHeight: 1.4, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 32 },
  business: { maxWidth: 280 },
  businessName: { fontSize: 14, lineHeight: 1.2, fontFamily: "Helvetica-Bold" },
  registration: { fontSize: 9, color: "#666666", marginTop: 2 },
  // Address, then phone and email: separate groups, so each reads at a glance.
  section: { marginTop: 8 },
  title: { fontSize: 18, lineHeight: 1.2, fontFamily: "Helvetica-Bold", textAlign: "right", marginBottom: 8 },
  meta: { textAlign: "right", marginBottom: 2 },
  block: { marginBottom: 24 },
  label: { fontSize: 8, color: "#666666", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  bold: { fontFamily: "Helvetica-Bold" },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 4,
    marginBottom: 4,
  },
  row: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#dddddd" },
  colDate: { width: 80 },
  colDescription: { flex: 1, paddingRight: 8 },
  colAmount: { width: 90, textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  totalLabel: { width: 120, textAlign: "right", paddingRight: 8, fontFamily: "Helvetica-Bold" },
  totalAmount: { width: 90, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 12 },
  extras: { marginTop: 24 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#888888", textAlign: "center" },
  watermark: {
    position: "absolute",
    top: 330,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 64,
    color: "#d50000",
    opacity: 0.2,
    transform: "rotate(-30deg)",
    fontFamily: "Helvetica-Bold",
  },
});

/** Phone and email together, set apart from the address above. */
function ContactLines({ phone, email }: { phone?: string | undefined; email?: string | undefined }) {
  if (!phone && !email) return null;
  return (
    <View style={styles.section}>
      {phone && <Text>{phone}</Text>}
      {email && <Text>{email}</Text>}
    </View>
  );
}

export function DocumentPdf({ type, number, revision, watermark, content }: DocumentPdfProps) {
  const spec = DOCUMENT_TYPES[type];
  const { issuer, recipient } = content;
  const bank = [issuer.bankName, issuer.accountName, issuer.accountNo].filter(Boolean);

  return (
    <Document title={`${spec.title} ${documentLabel(number, revision)}`} author={issuer.name}>
      <Page size="A4" style={styles.page}>
        {watermark && (
          <Text style={styles.watermark} fixed>
            {watermark}
          </Text>
        )}

        <View style={styles.header}>
          <View style={styles.business}>
            <Text style={styles.businessName}>{issuer.name}</Text>
            {issuer.registrationNo && <Text style={styles.registration}>{issuer.registrationNo}</Text>}
            {issuer.address && <Text style={styles.section}>{issuer.address}</Text>}
            <ContactLines phone={issuer.phone} email={issuer.email} />
          </View>
          <View>
            <Text style={styles.title}>{spec.title}</Text>
            <Text style={styles.meta}>
              <Text style={styles.bold}>No. </Text>
              {documentLabel(number, revision)}
            </Text>
            <Text style={styles.meta}>
              <Text style={styles.bold}>Date </Text>
              {formatDate(content.date)}
            </Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>{spec.recipientLabel}</Text>
          <Text style={styles.bold}>{recipient.name}</Text>
          {recipient.address && <Text style={styles.section}>{recipient.address}</Text>}
          <ContactLines phone={recipient.phone} email={recipient.email} />
        </View>

        <View style={styles.tableHead}>
          <Text style={[styles.colDate, styles.bold]}>Date</Text>
          <Text style={[styles.colDescription, styles.bold]}>Description</Text>
          <Text style={[styles.colAmount, styles.bold]}>Amount</Text>
        </View>
        {content.lines.map((line, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.colDate}>{line.date ? formatDate(line.date) : ""}</Text>
            <Text style={styles.colDescription}>{line.description}</Text>
            <Text style={styles.colAmount}>{formatCents(line.amountCents)}</Text>
          </View>
        ))}
        <View style={styles.total}>
          <Text style={styles.totalLabel}>{spec.paid ? "Total paid" : "Total"}</Text>
          <Text style={styles.totalAmount}>{formatCents(content.totalCents)}</Text>
        </View>

        <View style={styles.extras}>
          {spec.paid && content.paidBy && (
            <Text>
              <Text style={styles.bold}>Paid by: </Text>
              {content.paidBy}
            </Text>
          )}
          {content.notes && <Text style={{ marginTop: 6 }}>{content.notes}</Text>}
          {!spec.paid && bank.length > 0 && (
            <Text style={{ marginTop: 6 }}>
              <Text style={styles.bold}>Bank: </Text>
              {bank.join(" · ")}
            </Text>
          )}
        </View>

        <Text style={styles.footer} fixed>
          {spec.paid ? "Thank you. This receipt confirms payment received." : issuer.name}
        </Text>
      </Page>
    </Document>
  );
}
