import { useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "@/lib/catalog-store";

type Row = {
  name: string;
  sku: string;
  category: string;
  brand: string;
  description: string;
  mrp: number;
  price: number;
  stock: number;
  lowStockAt: number;
  imageUrl?: string;
};

type ParsedRow = {
  line: number;
  raw: Record<string, string>;
  data: Row;
  errors: Partial<Record<keyof Row | "_row", string>>;
};

const HEADERS: (keyof Row)[] = [
  "name",
  "sku",
  "category",
  "brand",
  "description",
  "mrp",
  "price",
  "stock",
  "lowStockAt",
  "imageUrl",
];

const TEMPLATE =
  HEADERS.join(",") +
  "\n" +
  [
    "Wireless Mouse,MOU-WL-01,Electronics,Sonix,Ergonomic 2.4GHz mouse,899,599,25,5,",
    "Ceramic Mug 300ml,MUG-CER-300,Home & Kitchen,HearthCo,Matte-finish ceramic mug,349,249,40,10,",
  ].join("\n");

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else field += c;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function validateRow(raw: Record<string, string>, line: number): ParsedRow {
  const errors: ParsedRow["errors"] = {};
  const name = (raw.name ?? "").trim();
  const sku = (raw.sku ?? "").trim().toUpperCase();
  const category = (raw.category ?? "").trim();
  const brand = (raw.brand ?? "").trim();
  const description = (raw.description ?? "").trim();
  const imageUrl = (raw.imageUrl ?? "").trim();
  const mrp = Number(raw.mrp);
  const price = Number(raw.price);
  const stock = Number(raw.stock);
  const lowStockAt = raw.lowStockAt === "" || raw.lowStockAt == null ? 5 : Number(raw.lowStockAt);

  if (!name) errors.name = "Required";
  else if (name.length > 120) errors.name = "Too long";
  if (!sku) errors.sku = "Required";
  if (!category) errors.category = "Required";
  else if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number]))
    errors.category = `Must be one of: ${CATEGORIES.join(", ")}`;
  if (!brand) errors.brand = "Required";
  if (!description) errors.description = "Required";
  if (!Number.isFinite(mrp) || mrp < 0) errors.mrp = "Invalid number";
  if (!Number.isFinite(price) || price <= 0) errors.price = "Must be > 0";
  if (Number.isFinite(mrp) && Number.isFinite(price) && price > mrp)
    errors.price = "Price cannot exceed MRP";
  if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock))
    errors.stock = "Non-negative integer";
  if (!Number.isFinite(lowStockAt) || lowStockAt < 0) errors.lowStockAt = "Invalid";
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) errors.imageUrl = "Must start with http(s)://";

  return {
    line,
    raw,
    errors,
    data: {
      name,
      sku,
      category,
      brand,
      description,
      mrp: Number.isFinite(mrp) ? mrp : 0,
      price: Number.isFinite(price) ? price : 0,
      stock: Number.isFinite(stock) ? Math.floor(stock) : 0,
      lowStockAt: Number.isFinite(lowStockAt) ? Math.floor(lowStockAt) : 5,
      imageUrl: imageUrl || undefined,
    },
  };
}

export function ProductsCsvImport({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (rows: Row[]) => Promise<void> | void;
}) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const summary = useMemo(() => {
    const valid = rows.filter((r) => Object.keys(r.errors).length === 0).length;
    return { valid, invalid: rows.length - valid };
  }, [rows]);

  function reset() {
    setRows([]);
    setFileName("");
    setMissingHeaders([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onFile(f: File) {
    const text = await f.text();
    setFileName(f.name);
    const grid = parseCSV(text);
    if (!grid.length) {
      setRows([]);
      setMissingHeaders([]);
      toast.error("CSV appears to be empty");
      return;
    }
    const headers = grid[0].map((h) => h.trim());
    const missing = HEADERS.filter(
      (h) => !["imageUrl", "lowStockAt"].includes(h) && !headers.includes(h),
    );
    setMissingHeaders(missing);
    if (missing.length) {
      setRows([]);
      return;
    }
    const parsed: ParsedRow[] = grid.slice(1).map((cells, i) => {
      const raw: Record<string, string> = {};
      headers.forEach((h, idx) => (raw[h] = (cells[idx] ?? "").trim()));
      return validateRow(raw, i + 2);
    });
    // Duplicate SKU detection within file
    const seen = new Map<string, number>();
    parsed.forEach((r) => {
      const s = r.data.sku;
      if (!s) return;
      if (seen.has(s)) {
        r.errors.sku = `Duplicate SKU (also on line ${seen.get(s)})`;
      } else seen.set(s, r.line);
    });
    setRows(parsed);
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport() {
    const good = rows.filter((r) => Object.keys(r.errors).length === 0).map((r) => r.data);
    if (!good.length) return toast.error("No valid rows to import");
    setBusy(true);
    try {
      const BATCH_SIZE = 50;
      let totalImported = 0;
      for (let i = 0; i < good.length; i += BATCH_SIZE) {
        const chunk = good.slice(i, i + BATCH_SIZE);
        await onImport(chunk);
        totalImported += chunk.length;
      }
      toast.success(`Successfully imported ${totalImported} product${totalImported === 1 ? "" : "s"}`);
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Bulk import products from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV to add multiple products at once. Rows are validated below — fix errors in
            your file and re-upload.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <Button onClick={() => inputRef.current?.click()} variant="outline">
            <FileUp className="h-4 w-4" /> Choose CSV
          </Button>
          <Button onClick={downloadTemplate} variant="ghost">
            <Download className="h-4 w-4" /> Download template
          </Button>
          {fileName && (
            <span className="text-sm text-muted-foreground truncate max-w-[40ch]">{fileName}</span>
          )}
          {rows.length > 0 && (
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="h-4 w-4" /> {summary.valid} valid
              </span>
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertCircle className="h-4 w-4" /> {summary.invalid} with errors
              </span>
            </div>
          )}
        </div>

        {missingHeaders.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Missing required columns: <strong>{missingHeaders.join(", ")}</strong>. Expected
            headers: {HEADERS.join(", ")}.
          </div>
        )}

        {rows.length > 0 && (
          <div className="max-h-[52vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-14">Line</TableHead>
                  <TableHead className="w-10"></TableHead>
                  {HEADERS.map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const bad = Object.keys(r.errors).length > 0;
                  return (
                    <TableRow key={r.line} className={cn(bad && "bg-destructive/5")}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {r.line}
                      </TableCell>
                      <TableCell>
                        {bad ? (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        )}
                      </TableCell>
                      {HEADERS.map((h) => {
                        const err = r.errors[h as keyof Row];
                        const val = r.raw[h] ?? "";
                        return (
                          <TableCell
                            key={h}
                            className={cn(
                              "align-top text-xs",
                              err &&
                                "bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/40",
                            )}
                            title={err ?? undefined}
                          >
                            <div className="max-w-[22ch] truncate">{val || "—"}</div>
                            {err && <div className="mt-1 text-[10px] font-medium">{err}</div>}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={doImport} disabled={summary.valid === 0}>
            <Upload className="h-4 w-4" /> Import{" "}
            {summary.valid > 0 ? `${summary.valid} row${summary.valid === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
