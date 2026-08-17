// Responsive post grid + empty state. Styled with base44 design tokens (shadcn Tailwind classes).
import PostCard from "./PostCard";

export default function PostGrid({ posts, empty = "No posts yet." }) {
  if (!posts?.length) {
    return (
      <p className="text-muted-foreground p-4 text-center">{empty}</p>
    );
  }
  return (
    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))] gap-6">
      {posts.map((p) => <PostCard key={p.id} post={p} />)}
    </div>
  );
}
