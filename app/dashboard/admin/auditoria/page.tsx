import AuditLogPanel from "../components/AuditLogPanel";

export default function AuditoriaPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Auditoria do Sistema</h1>
      <AuditLogPanel />
    </div>
  );
}