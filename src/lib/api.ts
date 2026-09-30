const safeCompare = async (a: string, b: string): Promise<boolean> => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const encoder = new TextEncoder();
  const aEncoded = encoder.encode(a);
  const bEncoded = encoder.encode(b);
  if (aEncoded.length !== bEncoded.length) return false;
  return await crypto.subtle.timingSafeEqual(aEncoded, bEncoded);
};

export const validateApiTokenResponse = async (request: Request, apiToken: string) => {
  const ok = await validateApiToken(request, apiToken);
  if (!ok) {
    return Response.json({ message: "Invalid API token" }, { status: 401 });
  }
  return null;
};

export const validateApiToken = async (request: Request, apiToken: string): Promise<boolean> => {
  try {
    if (!request?.headers?.get) {
      console.error("Invalid request object");
      return false;
    }
    if (!apiToken) {
      console.error("No API token provided.");
      return false;
    }
    const authHeader = request.headers.get("authorization");
    const customTokenHeader = request.headers.get("x-api-token");
    let tokenToValidate = customTokenHeader;
    if (authHeader) {
      if (authHeader.startsWith("Bearer ")) {
        tokenToValidate = authHeader.substring(7);
      } else if (authHeader.startsWith("Token ")) {
        tokenToValidate = authHeader.substring(6);
      } else {
        tokenToValidate = authHeader;
      }
    }
    if (!tokenToValidate || tokenToValidate.length === 0) return false;
    return await safeCompare(apiToken.trim(), tokenToValidate.trim());
  } catch (error) {
    console.error("Error validating API token:", error);
    return false;
  }
};