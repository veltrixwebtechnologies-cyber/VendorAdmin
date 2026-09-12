import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, Sliders, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES } from "@/lib/catalog-store";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/filters")({
  head: () => ({ meta: [{ title: "Filter Management — Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminFiltersPage,
});

interface FilterDef {
  id: string;
  category_id: string | null;
  product_type_id: string | null;
  key: string;
  label: string;
  type: "single_select" | "multi_select" | "range" | "boolean" | "number" | "text" | "color" | "rating";
  unit: string | null;
  is_universal: boolean;
  is_required: boolean;
  is_active: boolean;
  display_order: number;
}

interface FilterOpt {
  id: string;
  filter_id: string;
  value: string;
  label: string;
  display_order: number;
  is_active: boolean;
}

function AdminFiltersPage() {
  const qc = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [editingDef, setEditingDef] = useState<Partial<FilterDef> | null>(null);
  const [editingOptFilter, setEditingOptFilter] = useState<FilterDef | null>(null);
  const [newOptValue, setNewOptValue] = useState("");
  const [newOptLabel, setNewOptLabel] = useState("");

  const filterDefsQ = useQuery<FilterDef[]>({
    queryKey: ["admin-filter-defs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("filter_definitions")
        .select("*")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data as FilterDef[]) ?? [];
    },
  });

  const filterOptsQ = useQuery<FilterOpt[]>({
    queryKey: ["admin-filter-opts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("filter_options")
        .select("*")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data as FilterOpt[]) ?? [];
    },
  });

  const upsertDefMut = useMutation({
    mutationFn: async (def: Partial<FilterDef>) => {
      const { data, error } = await (supabase as any)
        .from("filter_definitions")
        .upsert(def)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-filter-defs"] });
      toast.success("Filter definition saved");
      setEditingDef(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save filter definition"),
  });

  const deleteDefMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("filter_definitions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-filter-defs"] });
      toast.success("Filter definition deleted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete filter definition"),
  });

  const addOptMut = useMutation({
    mutationFn: async ({ filter_id, value, label }: { filter_id: string; value: string; label: string }) => {
      const { data, error } = await (supabase as any)
        .from("filter_options")
        .insert({ filter_id, value, label })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-filter-opts"] });
      toast.success("Option added");
      setNewOptValue("");
      setNewOptLabel("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to add option"),
  });

  const deleteOptMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("filter_options")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-filter-opts"] });
      toast.success("Option deleted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete option"),
  });

  const defs = filterDefsQ.data ?? [];
  const opts = filterOptsQ.data ?? [];

  const filteredDefs = useMemo(() => {
    if (selectedCategory === "all") return defs;
    if (selectedCategory === "universal") return defs.filter((d) => d.is_universal);
    return defs.filter((d) => d.is_universal || d.category_id);
  }, [defs, selectedCategory]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl flex items-center gap-2">
            <Sliders className="h-7 w-7 text-primary" /> Filter Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure dynamic product attribute filter definitions and option values.
          </p>
        </div>
        <Button
          onClick={() =>
            setEditingDef({
              key: "",
              label: "",
              type: "multi_select",
              is_universal: false,
              is_required: false,
              is_active: true,
              display_order: defs.length + 1,
            })
          }
          className="gap-1"
        >
          <Plus className="h-4 w-4" /> Add Filter Definition
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4 pt-6">
          <div className="flex items-center gap-3">
            <Label className="text-xs font-semibold">Filter by Category:</Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Filters ({defs.length})</SelectItem>
                <SelectItem value="universal">Universal Filters</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filterDefsQ.isLoading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : filteredDefs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No filter definitions configured for this category.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDefs.map((d) => {
                const defOpts = opts.filter((o) => o.filter_id === d.id);
                return (
                  <Card key={d.id} className="relative overflow-hidden">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                            <span>{d.label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">({d.key})</span>
                          </h4>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {d.type}
                            </Badge>
                            {d.is_universal && (
                              <Badge variant="secondary" className="text-[10px] bg-sky-500/10 text-sky-700">
                                Universal
                              </Badge>
                            )}
                            {d.is_required && (
                              <Badge variant="secondary" className="text-[10px] bg-rose-500/10 text-rose-700">
                                Required
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditingDef(d)}
                            className="h-7 w-7"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Delete filter "${d.label}"?`)) {
                                deleteDefMut.mutate(d.id);
                              }
                            }}
                            className="h-7 w-7 text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Options Preview */}
                      {(d.type === "multi_select" || d.type === "single_select" || d.type === "color") && (
                        <div className="border-t pt-2 space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
                            <span>Options ({defOpts.length})</span>
                            <button
                              type="button"
                              onClick={() => setEditingOptFilter(d)}
                              className="text-primary hover:underline text-[11px]"
                            >
                              + Manage Options
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                            {defOpts.map((o) => (
                              <span
                                key={o.id}
                                className="px-2 py-0.5 rounded bg-muted text-[11px] font-medium border text-foreground"
                              >
                                {o.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Definition Dialog */}
      <Dialog open={!!editingDef} onOpenChange={(o) => !o && setEditingDef(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDef?.id ? "Edit Filter Definition" : "New Filter Definition"}</DialogTitle>
            <DialogDescription>
              Configure attribute key, label, input type, and scope.
            </DialogDescription>
          </DialogHeader>

          {editingDef && (
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Attribute Key</Label>
                  <Input
                    placeholder="e.g. size, color, ram"
                    value={editingDef.key || ""}
                    onChange={(e) =>
                      setEditingDef({ ...editingDef, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })
                    }
                  />
                </div>
                <div>
                  <Label>Display Label</Label>
                  <Input
                    placeholder="e.g. Size, Color, RAM"
                    value={editingDef.label || ""}
                    onChange={(e) => setEditingDef({ ...editingDef, label: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Filter Type</Label>
                  <Select
                    value={editingDef.type || "multi_select"}
                    onValueChange={(v: any) => setEditingDef({ ...editingDef, type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multi_select">Multi Select</SelectItem>
                      <SelectItem value="single_select">Single Select</SelectItem>
                      <SelectItem value="color">Color Picker</SelectItem>
                      <SelectItem value="range">Range Slider</SelectItem>
                      <SelectItem value="boolean">Boolean Toggle</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Unit (Optional)</Label>
                  <Input
                    placeholder="e.g. GB, kg, ₹"
                    value={editingDef.unit || ""}
                    onChange={(e) => setEditingDef({ ...editingDef, unit: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={editingDef.is_universal ?? false}
                    onChange={(e) => setEditingDef({ ...editingDef, is_universal: e.target.checked })}
                  />
                  <span>Universal Filter</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={editingDef.is_required ?? false}
                    onChange={(e) => setEditingDef({ ...editingDef, is_required: e.target.checked })}
                  />
                  <span>Required in Seller Form</span>
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDef(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editingDef?.key || !editingDef.label) {
                  return toast.error("Key and Label are required");
                }
                upsertDefMut.mutate(editingDef);
              }}
            >
              Save Definition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Options Dialog */}
      <Dialog open={!!editingOptFilter} onOpenChange={(o) => !o && setEditingOptFilter(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Options: {editingOptFilter?.label}</DialogTitle>
          </DialogHeader>

          {editingOptFilter && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Value (e.g. 8GB)"
                  value={newOptValue}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewOptValue(val);
                    if (!newOptLabel) setNewOptLabel(val);
                  }}
                  className="text-xs h-9"
                />
                <Input
                  placeholder="Label (e.g. 8 GB)"
                  value={newOptLabel}
                  onChange={(e) => setNewOptLabel(e.target.value)}
                  className="text-xs h-9"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (!newOptValue.trim()) return toast.error("Value required");
                    addOptMut.mutate({
                      filter_id: editingOptFilter.id,
                      value: newOptValue.trim(),
                      label: (newOptLabel || newOptValue).trim(),
                    });
                  }}
                  className="h-9 px-3 shrink-0"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>

              <div className="divide-y border rounded-lg max-h-60 overflow-y-auto">
                {opts
                  .filter((o) => o.filter_id === editingOptFilter.id)
                  .map((o) => (
                    <div key={o.id} className="flex items-center justify-between p-2.5 text-xs">
                      <div>
                        <span className="font-bold">{o.label}</span>
                        <span className="ml-2 font-mono text-muted-foreground">({o.value})</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteOptMut.mutate(o.id)}
                        className="h-7 w-7 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setEditingOptFilter(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
