import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class FileMetadata {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  originalPath: string;

  @Column()
  filename: string;

  @Column()
  fileType: string;

  @Column()
  fileDateTime: Date;

  @Column()
  fileSize: number;
}