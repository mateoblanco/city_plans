"use client";

import { useEffect } from "react";
import { whenVisible } from "@/components/Tracking/utils/view";
import { track } from "@/lib/product-analytics/track";

type Props = {
  guide: string;
};

/** guide_viewed (analítica de producto): en un efecto y con la página visible, nunca en el render ni en el prefetch. */
const GuideViewed = (props: Props) => {
  useEffect(() => whenVisible(document, () => track("guide_viewed", { guide: props.guide })), [props.guide]);
  return null;
};

export default GuideViewed;
