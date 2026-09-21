import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { toPhantomServiceError, verifyPhantomChallenge } from "@/lib/integrations/phantom/service"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  try {
    const body = (await req.json()) as {
      walletAddress?: string
      signatureBase64?: string
      evmAddress?: string
      evmChainId?: string
    }
    const result = await verifyPhantomChallenge({
      scope: { userId },
      walletAddress: String(body.walletAddress || ""),
      signatureBase64: String(body.signatureBase64 || ""),
      evmAddress: String(body.evmAddress || ""),
      evmChainId: String(body.evmChainId || ""),
    })
    return NextResponse.json({ ok: true, wallet: result })
  } catch (error) {
    const normalized = toPhantomServiceError(error)
    return NextResponse.json(
      { ok: false, code: normalized.code, error: normalized.message },
      { status: normalized.status },
    )
  }
}
