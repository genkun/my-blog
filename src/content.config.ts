// src/content.config.ts (Astro assets version)
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Dùng image() để frontmatter image trở thành ImageMetadata cho Astro <Image />
// LƯU Ý: Chuỗi trong frontmatter phải là đường dẫn TƯƠNG ĐỐI từ file .md tới src/assets/...
// Ví dụ: bài trong src/content/posts/... thì image: ../../assets/images/cover.png
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "src/content/posts" }),
  schema: ({ image }) => z.object({
    title: z.string(),
    slug: z.string(),
    published: z.string(),
    updated: z.string().optional(),
    author: z.string().optional(),
    lang: z.string().optional(),
    canonical: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    image: image().optional(),      // dùng Astro assets
  }).passthrough(),
});

export const collections = { blog };
