import { useCallback } from "react";
import { Upload, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  uploadedFile: File | null;
}

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export const FileUpload = ({ onFileSelect, uploadedFile }: FileUploadProps) => {
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
      e.target.value = "";
    },
    [onFileSelect]
  );

  if (uploadedFile) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="truncate flex-1">{uploadedFile.name}</span>
        <span className="text-xs text-muted-foreground">
          {(uploadedFile.size / 1024).toFixed(0)} KB
        </span>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="relative"
    >
      <label
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md border border-dashed border-border",
          "text-sm text-muted-foreground cursor-pointer",
          "hover:bg-accent/50 transition-colors"
        )}
      >
        <Upload className="h-4 w-4" />
        <span>Перетягніть файл або натисніть (PDF, Excel, CSV, DOCX, зображення)</span>
        <input
          type="file"
          className="hidden"
          accept={ACCEPTED_TYPES.join(",")}
          onChange={handleChange}
        />
      </label>
    </div>
  );
};
