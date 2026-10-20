import { SeoClusterLanding } from "@/components/SeoClusterLanding";
import { SEO_CLUSTER_CONTENT } from "@shared/seo-cluster-content";

export default function LocalSeo() {
  return <SeoClusterLanding content={SEO_CLUSTER_CONTENT["/local-seo"]} />;
}