'use client'
'use client'

import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Star, StarOff, Copy, Plus, Download, Upload, Filter, MoreVertical, Pencil, Trash2, Sparkles } from "lucide-react"

type Status = "Ativa" | "Em revisão" | "Arquivada"

type Resposta = {
  id: string
  tema: string
  subtema: string
  assunto: string
  produto: string
  canal: "Chat" | "E-mail" | "Telefone" | "WhatsApp" | "Omnichannel"
  status: Status
  tags: string[]
  resposta: string
  atualizadoEm: string
  favorito?: boolean
}

const seed: Resposta[] = [
  {
    id: "1",
    tema: "Pagamento",
    subtema: "Boleto",
    assunto: "2ª via de boleto",
    produto: "Assinatura",
    canal: "Chat",
    status: "Ativa",
    tags: ["boleto", "segunda via", "portal"],
    resposta:
      "Você pode emitir a 2ª via acessando o Portal do Cliente > Financeiro > Boletos. Se preferir, me informe CPF/CNPJ e eu confirmo o link para você.",
    atualizadoEm: new Date().toISOString(),
    favorito: true,
  },
  {
    id: "2",
    tema: "Cancelamento",
    subtema: "Contrato",
    assunto: "Solicitar cancelamento",
    produto: "Plano Pro",
    canal: "WhatsApp",
    status: "Ativa",
    tags: ["cancelamento", "protocolo", "prazo"],
    resposta:
      "Consigo te ajudar com o cancelamento. Para iniciar, confirme: nome completo, CPF/CNPJ e o motivo. Após abertura, o prazo de conclusão é de até 2 dias úteis.",
    atualizadoEm: new Date().toISOString(),
  },
  {
    id: "3",
    tema: "Entrega",
    subtema: "Prazo",
    assunto: "Prazo de entrega",
    produto: "Loja",
    canal: "E-mail",
    status: "Ativa",
    tags: ["prazo", "rastreamento"],
    resposta:
      "O prazo médio é de 5 dias úteis após confirmação do pagamento. Se você me passar o CEP, eu verifico a previsão exata e o status do envio.",
    atualizadoEm: new Date().toISOString(),
  },
  {
    id: "4",
    tema: "Pagamento",
    subtema: "Reembolso",
    assunto: "Estorno",
    produto: "Loja",
    canal: "Chat",
    status: "Em revisão",
    tags: ["estorno", "cartão", "pix"],
    resposta:
      "O estorno depende do método: cartão (até 2 faturas) e PIX (até 7 dias corridos). Vou confirmar o seu caso pelo pedido e te retorno.",
    atualizadoEm: new Date().toISOString(),
  },
  {
    id: "5",
    tema: "Conta",
    subtema: "Acesso",
    assunto: "Alterar senha",
    produto: "Plataforma",
    canal: "Omnichannel",
    status: "Ativa",
    tags: ["senha", "login", "segurança"],
    resposta: "Acesse Configurações > Segurança > Alterar senha. Se não lembrar a atual, use “Esqueci minha senha” na tela de login.",
    atualizadoEm: new Date().toISOString(),
  },
]

function unique(vals: string[]) {
  return Array.from(new Set(vals)).sort((a, b) => a.localeCompare(b))
}

function toCsv(rows: Resposta[]) {
  const header = ["id", "tema", "subtema", "assunto", "produto", "canal", "status", "tags", "resposta", "atualizadoEm", "favorito"]
  const esc = (v: unknown) => {
    const s = String(v ?? "")
    if (s.includes("\n") || s.includes(",") || s.includes('"')) return '"' + s.replaceAll('"', '""') + '"'
    return s
  }
  const lines = [header.join(",")]
  for (const r of rows) {
    lines.push(
      [r.id, r.tema, r.subtema, r.assunto, r.produto, r.canal, r.status, r.tags.join("|"), r.resposta, r.atualizadoEm, r.favorito ? "true" : "false"]
        .map(esc)
        .join(",")
    )
  }
  return lines.join("\n")
}

function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function uuid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

function clampText(s: string, max = 180) {
  if (!s) return s
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s
}

function containsIgnore(hay: string, needle: string) {
  return hay.toLowerCase().includes(needle.toLowerCase())
}

function makePrompt(r: Resposta) {
  return `Você é um atendente. Responda com clareza e objetividade.

Contexto:
- Tema: ${r.tema}
- Subtema: ${r.subtema}
- Assunto: ${r.assunto}
- Produto: ${r.produto}
- Canal: ${r.canal}

Base sugerida (pode adaptar):
${r.resposta}

Agora gere a resposta final e inclua, se necessário, uma pergunta de confirmação para avançar.`
}

function EditorDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial: Resposta | null
  onSave: (data: Omit<Resposta, "id" | "atualizadoEm">) => void
}) {
  const [tema, setTema] = useState("")
  const [subtema, setSubtema] = useState("")
  const [assunto, setAssunto] = useState("")
  const [produto, setProduto] = useState("")
  const [canal, setCanal] = useState<Resposta["canal"]>("Chat")
  const [status, setStatus] = useState<Status>("Ativa")
  const [tags, setTags] = useState("")
  const [resposta, setResposta] = useState("")
  const [favorito, setFavorito] = useState(false)

  useEffect(() => {
    if (!open) return
    setTema(initial?.tema ?? "")
    setSubtema(initial?.subtema ?? "")
    setAssunto(initial?.assunto ?? "")
    setProduto(initial?.produto ?? "")
    setCanal(initial?.canal ?? "Chat")
    setStatus(initial?.status ?? "Ativa")
    setTags((initial?.tags ?? []).join("|"))
    setResposta(initial?.resposta ?? "")
    setFavorito(!!initial?.favorito)
  }, [open, initial])

  const disabled = !tema.trim() || !assunto.trim() || !resposta.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar resposta" : "Nova resposta"}</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Tema</Label>
            <Input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ex: Pagamento" />
          </div>
          <div className="space-y-2">
            <Label>Subtema</Label>
            <Input value={subtema} onChange={(e) => setSubtema(e.target.value)} placeholder="Ex: Boleto" />
          </div>
          <div className="space-y-2">
            <Label>Assunto</Label>
            <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Ex: 2ª via" />
          </div>
          <div className="space-y-2">
            <Label>Produto</Label>
            <Input value={produto} onChange={(e) => setProduto(e.target.value)} placeholder="Ex: Assinatura" />
          </div>

          <div className="space-y-2">
            <Label>Canal</Label>
            <Select value={canal} onValueChange={(v) => setCanal(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["Chat", "E-mail", "Telefone", "WhatsApp", "Omnichannel"] as const).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["Ativa", "Em revisão", "Arquivada"] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Tags</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Separe por |  Ex: boleto|segunda via|portal" />
            <div className="text-xs text-muted-foreground">Dica: use tags para melhorar a busca e a recomendação por IA.</div>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Resposta</Label>
            <Textarea value={resposta} onChange={(e) => setResposta(e.target.value)} placeholder="Cole aqui a resposta padrão…" className="min-h-[160px]" />
          </div>

          <div className="flex items-center gap-2 md:col-span-2">
            <Checkbox checked={favorito} onCheckedChange={(v) => setFavorito(!!v)} />
            <span className="text-sm">Marcar como favorito</span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-2xl" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="rounded-2xl"
            disabled={disabled}
            onClick={() =>
              onSave({
                tema: tema.trim(),
                subtema: subtema.trim() || "Geral",
                assunto: assunto.trim(),
                produto: produto.trim() || "Geral",
                canal,
                status,
                tags: tags
                  .split("|")
                  .map((t) => t.trim())
                  .filter(Boolean),
                resposta: resposta.trim(),
                favorito,
              } as any)
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function Page() {
  const [respostas, setRespostas] = useState<Resposta[]>(seed)
  useEffect(() => {
  const saved = localStorage.getItem("base_respostas")
  if (saved) setRespostas(JSON.parse(saved))
}, [])

useEffect(() => {
  localStorage.setItem("base_respostas", JSON.stringify(respostas))
}, [respostas])

  const [busca, setBusca] = useState("")
  const [tema, setTema] = useState("Todos")
  const [subtema, setSubtema] = useState("Todos")
  const [produto, setProduto] = useState("Todos")
  const [canal, setCanal] = useState("Todos")
  const [status, setStatus] = useState<Status | "Todos">("Todos")
  const [somenteFavoritos, setSomenteFavoritos] = useState(false)

  const [view, setView] = useState<"cards" | "tabela">("cards")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement | null>(null)

  const opcoes = useMemo(() => {
    return {
      temas: ["Todos", ...unique(respostas.map((r) => r.tema))],
      subtemas: ["Todos", ...unique(respostas.map((r) => r.subtema))],
      produtos: ["Todos", ...unique(respostas.map((r) => r.produto))],
      canais: ["Todos", ...unique(respostas.map((r) => r.canal))],
      status: ["Todos", ...unique(respostas.map((r) => r.status))] as Array<"Todos" | Status>,
    }
  }, [respostas])

  useEffect(() => {
    setSubtema("Todos")
  }, [tema])

  const respostasFiltradas = useMemo(() => {
    const b = busca.trim()
    return respostas
      .filter((r) => {
        const matchBusca =
          !b ||
          containsIgnore(r.assunto, b) ||
          containsIgnore(r.resposta, b) ||
          containsIgnore(r.tema, b) ||
          containsIgnore(r.subtema, b) ||
          containsIgnore(r.produto, b) ||
          r.tags.some((t) => containsIgnore(t, b))

        const matchTema = tema === "Todos" || r.tema === tema
        const matchSubtema = subtema === "Todos" || r.subtema === subtema
        const matchProduto = produto === "Todos" || r.produto === produto
        const matchCanal = canal === "Todos" || r.canal === canal
        const matchStatus = status === "Todos" || r.status === status
        const matchFav = !somenteFavoritos || !!r.favorito

        return matchBusca && matchTema && matchSubtema && matchProduto && matchCanal && matchStatus && matchFav
      })
      .sort((a, b2) => {
        const fa = a.favorito ? 1 : 0
        const fb = b2.favorito ? 1 : 0
        if (fa !== fb) return fb - fa
        return new Date(b2.atualizadoEm).getTime() - new Date(a.atualizadoEm).getTime()
      })
  }, [respostas, busca, tema, subtema, produto, canal, status, somenteFavoritos])

  const stats = useMemo(() => {
    const total = respostas.length
    const ativos = respostas.filter((r) => r.status === "Ativa").length
    const revisao = respostas.filter((r) => r.status === "Em revisão").length
    const arquivadas = respostas.filter((r) => r.status === "Arquivada").length
    const fav = respostas.filter((r) => r.favorito).length
    return { total, ativos, revisao, arquivadas, fav }
  }, [respostas])

  const editing = useMemo(() => {
    if (!editingId) return null
    return respostas.find((r) => r.id === editingId) ?? null
  }, [editingId, respostas])

  function openCreate() {
    setEditingId(null)
    setDialogOpen(true)
  }

  function openEdit(id: string) {
    setEditingId(id)
    setDialogOpen(true)
  }

  function remove(id: string) {
    setRespostas((prev) => prev.filter((r) => r.id !== id))
  }

  function toggleFav(id: string) {
    setRespostas((prev) => prev.map((r) => (r.id === id ? { ...r, favorito: !r.favorito, atualizadoEm: new Date().toISOString() } : r)))
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      ta.remove()
    }
  }

  function exportJson() {
    downloadText(`base-respostas-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(respostas, null, 2), "application/json;charset=utf-8")
  }

  function exportCsv() {
    downloadText(`base-respostas-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(respostas), "text/csv;charset=utf-8")
  }

  function triggerImport() {
    fileRef.current?.click()
  }

  async function handleImport(file?: File | null) {
    if (!file) return
    const text = await file.text()
    const ext = file.name.toLowerCase().split(".").pop()

    try {
      if (ext === "json") {
        const data = JSON.parse(text)
        if (!Array.isArray(data)) throw new Error("JSON inválido: esperado array")

        const parsed: Resposta[] = data
          .filter(Boolean)
          .map((r: any) => ({
            id: String(r.id ?? uuid()),
            tema: String(r.tema ?? ""),
            subtema: String(r.subtema ?? ""),
            assunto: String(r.assunto ?? ""),
            produto: String(r.produto ?? ""),
            canal: (r.canal ?? "Chat") as Resposta["canal"],
            status: (r.status ?? "Ativa") as Status,
            tags: Array.isArray(r.tags) ? r.tags.map(String) : String(r.tags ?? "").split("|").filter(Boolean),
            resposta: String(r.resposta ?? ""),
            atualizadoEm: String(r.atualizadoEm ?? new Date().toISOString()),
            favorito: !!r.favorito,
          }))
          .filter((r) => r.tema && r.assunto && r.resposta)

        setRespostas(parsed)
      } else if (ext === "csv") {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
        const header = lines.shift()?.split(",").map((h) => h.trim()) ?? []
        const idx = (k: string) => header.indexOf(k)

        if (!header.includes("tema") || !header.includes("assunto") || !header.includes("resposta")) {
          throw new Error("CSV inválido: faltam colunas mínimas (tema, assunto, resposta)")
        }

        const parsed: Resposta[] = lines.map((line) => {
          const parts = line.split(",")
          const get = (k: string) => parts[idx(k)] ?? ""
          return {
            id: get("id") || uuid(),
            tema: get("tema"),
            subtema: get("subtema"),
            assunto: get("assunto"),
            produto: get("produto"),
            canal: (get("canal") as any) || "Chat",
            status: (get("status") as any) || "Ativa",
            tags: (get("tags") || "").split("|").filter(Boolean),
            resposta: get("resposta"),
            atualizadoEm: get("atualizadoEm") || new Date().toISOString(),
            favorito: (get("favorito") || "").toLowerCase() === "true",
          } as Resposta
        })

        setRespostas(parsed.filter((r) => r.tema && r.assunto && r.resposta))
      } else {
        throw new Error("Formato não suportado. Use .json ou .csv")
      }
    } catch (e) {
      console.error("Falha ao importar base", e)
      alert("Falha ao importar. Use JSON ou CSV com colunas corretas.")
    }
  }

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Dashboard de Respostas</h1>
            <p className="text-muted-foreground">Base de conhecimento para atendentes filtrarem por temas, assuntos e contexto.</p>
          </div>

          <div className="flex gap-2 items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-2xl">
                  <MoreVertical className="h-4 w-4 mr-2" /> Ações
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Exportar</DropdownMenuLabel>
                <DropdownMenuItem onClick={exportJson}>
                  <Download className="h-4 w-4 mr-2" /> JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportCsv}>
                  <Download className="h-4 w-4 mr-2" /> CSV
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Importar</DropdownMenuLabel>
                <DropdownMenuItem onClick={triggerImport}>
                  <Upload className="h-4 w-4 mr-2" /> JSON/CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={openCreate} className="rounded-2xl">
              <Plus className="h-4 w-4 mr-2" /> Nova resposta
            </Button>

            <input ref={fileRef} type="file" accept=".json,.csv" className="hidden" onChange={(e) => handleImport(e.target.files?.[0])} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: "Total", value: stats.total },
            { label: "Ativas", value: stats.ativos },
            { label: "Em revisão", value: stats.revisao },
            { label: "Arquivadas", value: stats.arquivadas },
            { label: "Favoritos", value: stats.fav },
          ].map((s) => (
            <Card key={s.label} className="rounded-2xl shadow-sm">
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-lg font-semibold">{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>

      <Separator />

      <div className="grid md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-2">
          <Label className="text-xs text-muted-foreground">Busca</Label>
          <Input placeholder="Pesquisar tema, assunto, tags ou conteúdo da resposta…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Tema</Label>
          <Select value={tema} onValueChange={setTema}>
            <SelectTrigger>
              <SelectValue placeholder="Tema" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.temas.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Subtema</Label>
          <Select value={subtema} onValueChange={setSubtema}>
            <SelectTrigger>
              <SelectValue placeholder="Subtema" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.subtemas.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Produto</Label>
          <Select value={produto} onValueChange={setProduto}>
            <SelectTrigger>
              <SelectValue placeholder="Produto" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.produtos.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Canal</Label>
          <Select value={canal} onValueChange={setCanal}>
            <SelectTrigger>
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.canais.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as any)}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.status.map((st) => (
                <SelectItem key={st} value={st}>
                  {st}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="md:col-span-6 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">{respostasFiltradas.length} resultados</div>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <Checkbox checked={somenteFavoritos} onCheckedChange={(v) => setSomenteFavoritos(!!v)} />
              <span className="text-sm">Somente favoritos</span>
            </div>
          </div>

          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList className="rounded-2xl">
              <TabsTrigger value="cards" className="rounded-2xl">
                Cards
              </TabsTrigger>
              <TabsTrigger value="tabela" className="rounded-2xl">
                Tabela
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <TabsContent value="cards" className="mt-0">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {respostasFiltradas.map((r) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="rounded-2xl shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex gap-2 flex-wrap">
                        <Badge>{r.tema}</Badge>
                        <Badge variant="secondary">{r.subtema}</Badge>
                        <Badge variant="outline">{r.produto}</Badge>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="rounded-2xl" onClick={() => toggleFav(r.id)}>
                          {r.favorito ? <Star className="h-4 w-4" /> : <StarOff className="h-4 w-4" />}
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="rounded-2xl" title="Mais">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r.id)}>
                              <Pencil className="h-4 w-4 mr-2" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => remove(r.id)}>
                              <Trash2 className="h-4 w-4 mr-2" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <h3 className="font-semibold">{r.assunto}</h3>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                        <span>Canal: {r.canal}</span>
                        <span>•</span>
                        <span>Status: {r.status}</span>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground">{clampText(r.resposta, 220)}</p>

                    <div className="flex flex-wrap gap-1">
                      {r.tags.slice(0, 6).map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                      {r.tags.length > 6 ? (
                        <Badge variant="secondary" className="text-xs">
                          +{r.tags.length - 6}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">Atualizado: {new Date(r.atualizadoEm).toLocaleString()}</div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="rounded-2xl" onClick={() => copy(r.resposta)}>
                          <Copy className="h-4 w-4 mr-2" /> Copiar
                        </Button>
                        <Button variant="outline" className="rounded-2xl" onClick={() => copy(makePrompt(r))}>
                          <Sparkles className="h-4 w-4 mr-2" /> Prompt
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="tabela" className="mt-0">
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[48px]">Fav</TableHead>
                    <TableHead>Tema</TableHead>
                    <TableHead>Subtema</TableHead>
                    <TableHead>Assunto</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[120px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {respostasFiltradas.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="rounded-2xl" onClick={() => toggleFav(r.id)}>
                          {r.favorito ? <Star className="h-4 w-4" /> : <StarOff className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge>{r.tema}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{r.subtema}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{r.assunto}</TableCell>
                      <TableCell>{r.produto}</TableCell>
                      <TableCell>{r.canal}</TableCell>
                      <TableCell>{r.status}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => copy(r.resposta)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => openEdit(r.id)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => remove(r.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        onSave={(data) => {
          setRespostas((prev) => {
            if (editingId) {
              return prev.map((r) => (r.id === editingId ? { ...r, ...data, atualizadoEm: new Date().toISOString() } : r))
            }
            const novo: Resposta = {
              id: uuid(),
              favorito: false,
              atualizadoEm: new Date().toISOString(),
              ...(data as any),
            }
            return [novo, ...prev]
          })
          setDialogOpen(false)
        }}
      />
    </div>
  )
}