import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Coffee, Heart } from "lucide-react";

const DONATION_URL = "https://www.paypal.com/paypalme/parrella/";

export function WelcomePopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem("welcome_dismissed");
    if (!dismissed) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    setOpen(false);
    localStorage.setItem("welcome_dismissed", "1");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-welcome">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-primary" />
            Thanks for using CubeMap to HDRI!
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                Hey there! I made this tool to easily convert cubemaps to equirectangular HDRIs, with a mode specifically made for SpaceEngine skybox exports that properly compensates for its unique coordinate system.
              </p>
              <p>
                This software is completely free for any use, including commercial. No limits, no restrictions. If you find it helpful and want to show some appreciation, consider buying me a cup of coffee!
              </p>
              <div className="flex items-center justify-center pt-1">
                <a
                  href={DONATION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium text-sm"
                  data-testid="link-donation-welcome"
                >
                  <Coffee className="w-4 h-4" />
                  Buy me a coffee
                </a>
              </div>
              <p className="text-xs text-center text-muted-foreground/70">
                — David
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end pt-2">
          <Button onClick={handleClose} data-testid="button-welcome-close">
            Got it!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
