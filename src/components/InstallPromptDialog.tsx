import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Smartphone } from "lucide-react";
import { InstallGuide } from "@/components/InstallGuide";

interface InstallPromptDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InstallPromptDialog({ open, onClose }: InstallPromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <DialogTitle>App zum Startbildschirm</DialogTitle>
          </div>
          <DialogDescription>
            Installiere die Holzbau-Willroider-App für schnelleren Zugriff direkt vom
            Startbildschirm – wie eine native App.
          </DialogDescription>
        </DialogHeader>

        <InstallGuide onInstalled={onClose} />

        <Button variant="outline" onClick={onClose} className="w-full mt-2">
          Vielleicht später
        </Button>
      </DialogContent>
    </Dialog>
  );
}
