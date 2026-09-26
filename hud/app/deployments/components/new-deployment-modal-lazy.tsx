"use client"

import dynamic from "next/dynamic"

import type { NewDeploymentModalProps } from "./new-deployment-modal"

/** Loads the popup's code on demand; call on hover/focus of an entry point so the click opens it instantly. */
export const preloadNewDeploymentModal = () => import("./new-deployment-modal")

export const LazyNewDeploymentModal = dynamic<NewDeploymentModalProps>(
  () => preloadNewDeploymentModal().then((module) => module.NewDeploymentModal),
  { ssr: false },
)
