export function Placeholder({ title }: { title: string }) {
  return (
    <main className="screen">
      <h1 className="type-title-screen">{title}</h1>
      <p className="muted">See design/mockups for this screen.</p>
    </main>
  );
}
